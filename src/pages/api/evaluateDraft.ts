import { NextApiRequest, NextApiResponse } from "next";
import type { Evaluation } from "@/types/evaluation";
import {
  sanitizeProposalInput,
  verifyNearAuth,
  requestEvaluation,
  respondWithScreeningError,
} from "@/lib/server/screening";

/**
 * POST /api/evaluateDraft
 *
 * Public screening endpoint - evaluates proposals WITHOUT saving.
 * Supports both authenticated (NEAR wallet) and anonymous users.
 * Anonymous users have rate limiting (5 per 15 minutes per IP).
 */

// Simple in-memory rate limiter for anonymous users
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = 5;

function checkRateLimit(key: string): {
  allowed: boolean;
  remaining: number;
  resetTime?: number;
} {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    });
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
    };
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: record.resetTime,
    };
  }

  record.count++;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - record.count,
  };
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 60 * 1000);

function getClientIdentifier(req: NextApiRequest): string {
  // Try to get real IP from various headers (for proxies/load balancers)
  const forwarded = req.headers["x-forwarded-for"];
  const realIp = req.headers["x-real-ip"];

  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  if (typeof realIp === "string") {
    return realIp;
  }
  return req.socket.remoteAddress || "unknown";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Check if user is authenticated (optional for this endpoint)
  const authHeader = req.headers.authorization;
  let isAuthenticated = false;
  let accountId: string | undefined;

  if (authHeader) {
    try {
      const { result } = await verifyNearAuth(authHeader);
      isAuthenticated = true;
      accountId = result.accountId;
    } catch (error) {
      // Authentication failed, treat as anonymous
      // Don't return error - allow anonymous usage with rate limit
      console.log(
        "[EvaluateDraft] Auth verification failed, treating as anonymous"
      );
    }
  }

  // Apply rate limiting only for anonymous users
  if (!isAuthenticated) {
    const clientId = getClientIdentifier(req);
    const { allowed, remaining, resetTime } = checkRateLimit(clientId);

    // Always set remaining count header for anonymous users
    res.setHeader("X-RateLimit-Remaining", remaining.toString());
    res.setHeader("X-RateLimit-Limit", RATE_LIMIT_MAX_REQUESTS.toString());

    if (!allowed) {
      const retryAfter = resetTime
        ? Math.ceil((resetTime - Date.now()) / 1000)
        : RATE_LIMIT_WINDOW / 1000;
      res.setHeader("Retry-After", retryAfter.toString());
      return res.status(429).json({
        error: "Rate limit exceeded",
        message: `You've reached the limit of ${RATE_LIMIT_MAX_REQUESTS} free evaluations. Please try again in ${Math.ceil(
          retryAfter / 60
        )} minutes or connect your NEAR wallet for unlimited evaluations.`,
        retryAfter,
      });
    }
  }

  // Sanitize and validate input
  const { title, content } = req.body;
  let sanitizedTitle: string;
  let sanitizedContent: string;

  try {
    const sanitized = sanitizeProposalInput(title, content);
    sanitizedTitle = sanitized.title;
    sanitizedContent = sanitized.content;
  } catch (error) {
    return respondWithScreeningError(res, error);
  }

  // Request evaluation from AI
  try {
    const evaluation: Evaluation = await requestEvaluation(
      sanitizedTitle,
      sanitizedContent
    );

    const logPrefix = isAuthenticated
      ? `[EvaluateDraft] ${accountId}`
      : `[EvaluateDraft] Anonymous`;

    console.log(
      `${logPrefix} - Pass: ${evaluation.overallPass}, Quality: ${(
        evaluation.qualityScore * 100
      ).toFixed(0)}%, Attention: ${(evaluation.attentionScore * 100).toFixed(
        0
      )}%`
    );

    return res.status(200).json({
      evaluation,
      authenticatedAs: accountId,
    });
  } catch (error) {
    return respondWithScreeningError(res, error, "Failed to evaluate proposal");
  }
}
