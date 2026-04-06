import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { extractBaseAgentKey } from '@/data/node-mappings';
import { createAgentDisplayNames } from '@/utils/text-utils';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

interface InvestmentReportContentProps {
  outputNodeData: any;
  connectedAgentIds?: Set<string>;
}

type ActionType = 'long' | 'short' | 'hold';

export function InvestmentReportContent({
  outputNodeData,
  connectedAgentIds,
}: InvestmentReportContentProps) {
  // Check if this is a backtest result and return early if it is
  if (outputNodeData?.decisions?.backtest?.type === 'backtest_complete') {
    return null;
  }

  // Return early if no output data
  if (!outputNodeData || !outputNodeData.decisions) {
    return null;
  }

  const getActionIcon = (action: ActionType) => {
    switch (action) {
      case 'long':
        return <ArrowUp className="h-4 w-4 text-green-500" />;
      case 'short':
        return <ArrowDown className="h-4 w-4 text-red-500" />;
      case 'hold':
        return <Minus className="h-4 w-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  const getSignalBadge = (signal: string) => {
    const variant = signal === 'bullish' ? 'success' :
                   signal === 'bearish' ? 'destructive' : 'outline';

    return (
      <Badge variant={variant as any}>
        {signal}
      </Badge>
    );
  };

  const getConfidenceBadge = (confidence: number) => {
    let variant = 'outline';
    if (confidence >= 50) variant = 'success';
    else if (confidence >= 0) variant = 'warning';
    else variant = 'outline';
    const rounded = Number(confidence.toFixed(1));
    return (
      <Badge variant={variant as any}>
        {rounded}%
      </Badge>
    );
  };

  const renderJsonAsTable = (data: any) => {
    if (!data || typeof data !== 'object') return String(data);
    
    return (
      <div className="space-y-4">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="border rounded-md p-0 overflow-hidden">
            <div className="bg-muted/50 px-4 py-2 border-b">
              <h4 className="font-medium capitalize text-sm">{key.replace(/_/g, ' ')}</h4>
            </div>
            <div className="p-0">
              {typeof value === 'object' && value !== null ? (
                <Table>
                  <TableBody>
                    {Object.entries(value).map(([subKey, subValue]) => (
                      <TableRow key={subKey}>
                        <TableCell className="font-medium capitalize w-1/3 text-muted-foreground text-xs">
                          {subKey.replace(/_/g, ' ')}
                        </TableCell>
                        <TableCell className="whitespace-pre-line text-sm">
                          {String(subValue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-4">
                  <p className="text-sm">{String(value)}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Extract unique tickers from the data
  const tickers = Object.keys(outputNodeData.decisions || {});

  // Determine agents to show
  // If connectedAgentIds is provided, filter by it, otherwise show all agents in analyst_signals
  const agents = Object.keys(outputNodeData.analyst_signals || {})
    .filter(agent => {
      if (extractBaseAgentKey(agent) === 'risk_management_agent') return false;
      if (connectedAgentIds) {
        return Array.from(connectedAgentIds).includes(agent);
      }
      return true;
    });

  const agentDisplayNames = createAgentDisplayNames(agents);

  return (
    <div className="space-y-8 my-4 p-4 max-w-6xl mx-auto h-full overflow-y-auto">
      {/* Summary Section */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Summary</h2>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              Recommended trading actions based on analyst signals
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticker</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickers.map(ticker => {
                  const decision = outputNodeData.decisions[ticker];
                  const currentPrice = outputNodeData.current_prices?.[ticker] || 'N/A';
                  return (
                    <TableRow key={ticker}>
                      <TableCell className="font-medium">{ticker}</TableCell>
                      <TableCell>${typeof currentPrice === 'number' ? currentPrice.toFixed(2) : currentPrice}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getActionIcon(decision.action as ActionType)}
                          <span className="capitalize">{decision.action}</span>
                        </div>
                      </TableCell>
                      <TableCell>{decision.quantity}</TableCell>
                      <TableCell>{getConfidenceBadge(decision.confidence)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
      {/* Analyst Signals Section */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Analyst Signals</h2>
        <Accordion type="multiple" className="w-full">
          {tickers.map(ticker => (
            <AccordionItem key={ticker} value={ticker}>
              <AccordionTrigger className="text-base font-medium px-4 py-3 bg-muted/30 rounded-md hover:bg-muted/50">
                <div className="flex items-center gap-2">
                  {ticker}
                  <div className="flex items-center gap-1">
                    {getActionIcon(outputNodeData.decisions[ticker].action as ActionType)}
                    <span className="text-sm font-normal text-muted-foreground">
                      {outputNodeData.decisions[ticker].action} {outputNodeData.decisions[ticker].quantity} shares
                    </span>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-4 px-1">
                <div className="space-y-4">
                  {/* Agent Signals */}
                  <div className="grid grid-cols-1 gap-4">
                    {agents.map(agent => {
                      const signal = outputNodeData.analyst_signals[agent]?.[ticker];
                      if (!signal) return null;

                      return (
                        <Card key={agent} className="overflow-hidden">
                          <CardHeader className="bg-muted/50 pb-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-base">
                                {agentDisplayNames.get(agent) || agent}
                              </CardTitle>
                              <div className="flex items-center gap-2">
                                {getSignalBadge(signal.signal)}
                                {getConfidenceBadge(signal.confidence)}
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="pt-3">
                            {typeof signal.reasoning === 'string' ? (
                              <p className="text-sm whitespace-pre-line">
                                {signal.reasoning}
                              </p>
                            ) : (
                              <div className="bg-background rounded-md">
                                {renderJsonAsTable(signal.reasoning)}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </div>
  );
}
