"use client";

import { useState } from "react";
import { useNear } from "@/hooks/useNear";
import type { Evaluation } from "@/types/evaluation";
import { ProposalForm } from "@/components/proposal/ProposalForm";
import { ScreeningResults } from "@/components/proposal/screening/ScreeningResults";
import { ScreeningBadge } from "@/components/proposal/screening/ScreeningBadge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle, AlertTriangle } from "lucide-react";

export default function NewProposalPage() {
  const { signedAccountId } = useNear();
  const [title, setTitle] = useState("");
  const [proposal, setProposal] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");
  const [remainingEvaluations, setRemainingEvaluations] = useState<
    number | null
  >(null);

  const evaluateProposal = async () => {
    if (!title.trim() || !proposal.trim()) {
      setError("Please enter both title and proposal");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/evaluateDraft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, content: proposal }),
      });

      // Get rate limit info from headers
      const remaining = response.headers.get("X-RateLimit-Remaining");
      if (remaining) {
        setRemainingEvaluations(parseInt(remaining));
      }

      if (!response.ok) {
        const errorData = await response.json();

        if (response.status === 429) {
          const retryMinutes = Math.ceil((errorData.retryAfter || 900) / 60);
          throw new Error(
            `Rate limit exceeded. Please try again in ${retryMinutes} minutes or connect your NEAR wallet for unlimited evaluations.`
          );
        }

        throw new Error(
          errorData.error || `API request failed: ${response.status}`
        );
      }

      const data = await response.json();
      setResult(data.evaluation);
    } catch (err: any) {
      console.error("Evaluation error:", err);
      setError(err.message || "Failed to evaluate proposal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto py-10 px-4 space-y-6">
        <div className="space-y-3 text-center">
          <h1 className="text-3xl font-semibold">New Proposal</h1>
          <p className="text-muted-foreground">
            Use NEAR AI to privately check against established criteria.
          </p>
        </div>

        {/* Rate limit info for anonymous users */}
        {!signedAccountId && remainingEvaluations !== null && (
          <Alert className="border-green-500 bg-green-50 text-green-900">
            <AlertDescription>
              {`You have ${remainingEvaluations} free evaluation${
                remainingEvaluations !== 1 ? "s" : ""
              } remaining. Connect your NEAR wallet for unlimited evaluations.`}
            </AlertDescription>
          </Alert>
        )}

        {signedAccountId && (
          <div className="rounded-lg border p-4 bg-green-50 text-green-900">
            Connected as <strong>{signedAccountId}</strong>
          </div>
        )}

        <div className="rounded-lg border p-6 bg-card">
          <ProposalForm
            title={title}
            proposal={proposal}
            onTitleChange={setTitle}
            onProposalChange={setProposal}
            onSubmit={evaluateProposal}
            loading={loading}
          />
        </div>

        {error && (
          <div className="rounded-lg border border-destructive px-4 py-3 text-destructive bg-destructive/10">
            {error}
          </div>
        )}

        {result && (
          <>
            {result.overallPass ? (
              <Alert className="border-green-500 bg-green-50 text-green-900">
                <AlertDescription>
                  Your proposal is ready to publish to Discourse.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="border-yellow-500 bg-yellow-50 text-yellow-900">
                <AlertDescription>
                  Your proposal needs improvement. Review the feedback below,
                  make changes, and screen it again.
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-3">
              <ScreeningBadge
                screening={{
                  evaluation: result,
                  title: title || "Draft Proposal",
                  nearAccount: signedAccountId || "Anonymous",
                  timestamp: new Date().toISOString(),
                  revisionNumber: 1,
                  qualityScore: result.qualityScore,
                  attentionScore: result.attentionScore,
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
