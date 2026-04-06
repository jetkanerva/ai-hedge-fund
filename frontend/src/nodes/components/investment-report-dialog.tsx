import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InvestmentReportContent } from './investment-report-content';

interface InvestmentReportDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  outputNodeData: any;
  connectedAgentIds: Set<string>;
}

export function InvestmentReportDialog({
  isOpen,
  onOpenChange,
  outputNodeData,
  connectedAgentIds,
}: InvestmentReportDialogProps) {
  // Check if this is a backtest result and return early if it is
  // Backtest results should be displayed in the backtest output tab, not in the investment report dialog
  if (outputNodeData?.decisions?.backtest?.type === 'backtest_complete') {
    return null;
  }

  // Return early if no output data
  if (!outputNodeData || !outputNodeData.decisions) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="text-xl font-bold">Investment Report</DialogTitle>
        </DialogHeader>
        <InvestmentReportContent 
          outputNodeData={outputNodeData} 
          connectedAgentIds={connectedAgentIds} 
        />
      </DialogContent>
    </Dialog>
  );
}