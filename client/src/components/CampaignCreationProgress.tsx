import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export interface CampaignCreationStep {
  id: string;
  label: string;
  status: "pending" | "in-progress" | "completed" | "error";
  errorMessage?: string;
}

interface CampaignCreationProgressProps {
  steps: CampaignCreationStep[];
  className?: string;
}

export function CampaignCreationProgress({ steps, className }: CampaignCreationProgressProps) {
  const completedSteps = steps.filter(s => s.status === "completed").length;
  const totalSteps = steps.length;
  const progressPercentage = (completedSteps / totalSteps) * 100;

  return (
    <div className={cn("space-y-4", className)} data-testid="campaign-creation-progress">
      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Прогресс создания</span>
          <span className="font-medium">{completedSteps} / {totalSteps}</span>
        </div>
        <Progress value={progressPercentage} className="h-2" data-testid="progress-bar" />
      </div>

      {/* Steps List */}
      <div className="space-y-3">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className="flex items-start gap-3 p-3 rounded-lg border bg-card transition-colors"
            data-testid={`step-${step.id}`}
          >
            {/* Step Icon */}
            <div className="flex-shrink-0 mt-0.5">
              {step.status === "completed" && (
                <CheckCircle2 className="h-5 w-5 text-green-500" data-testid={`icon-completed-${step.id}`} />
              )}
              {step.status === "in-progress" && (
                <Loader2 className="h-5 w-5 text-blue-500 animate-spin" data-testid={`icon-loading-${step.id}`} />
              )}
              {step.status === "error" && (
                <XCircle className="h-5 w-5 text-destructive" data-testid={`icon-error-${step.id}`} />
              )}
              {step.status === "pending" && (
                <Circle className="h-5 w-5 text-muted-foreground/50" data-testid={`icon-pending-${step.id}`} />
              )}
            </div>

            {/* Step Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-sm font-medium",
                  step.status === "completed" && "text-green-600 dark:text-green-400",
                  step.status === "in-progress" && "text-blue-600 dark:text-blue-400",
                  step.status === "error" && "text-destructive",
                  step.status === "pending" && "text-muted-foreground"
                )}>
                  {index + 1}. {step.label}
                </span>
              </div>
              
              {step.status === "in-progress" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Выполняется...
                </p>
              )}
              
              {step.status === "error" && step.errorMessage && (
                <p className="text-xs text-destructive mt-1" data-testid={`error-message-${step.id}`}>
                  {step.errorMessage}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
