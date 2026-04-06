import { useReactFlow, type NodeProps } from '@xyflow/react';
import { ChevronDown, FileText, Play, Square, Upload, CheckCircle2, Loader2 } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useFlowContext } from '@/contexts/flow-context';
import { useLayoutContext } from '@/contexts/layout-context';
import { useNodeContext } from '@/contexts/node-context';
import { useFlowConnection } from '@/hooks/use-flow-connection';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useNodeState } from '@/hooks/use-node-state';
import { cn, formatKeyboardShortcut } from '@/lib/utils';
import { type FileInputNode as FileInputNodeType } from '../types';
import { NodeShell } from './node-shell';
import { api } from '@/services/api';
import { ModelProvider } from '@/services/types';

const runModes = [
  { value: 'single', label: 'Single Run' },
  { value: 'backtest', label: 'Backtest' },
];

interface ParsedPosition {
  ticker: string;
  quantity: string | number;
  tradePrice?: string | number;
  trade_price?: string | number;
  price?: string | number;
}

export function FileInputNode({
  data,
  selected,
  id,
  isConnectable,
}: NodeProps<FileInputNodeType>) {
  // Calculate default dates
  const today = new Date();
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(today.getMonth() - 3);
  
  // Use persistent state hooks
  const [tickers, setTickers] = useNodeState<string[]>(id, 'tickers', []);
  const [portfolioPositions, setPortfolioPositions] = useNodeState<ParsedPosition[]>(id, 'portfolioPositions', []);
  const [inputType, setInputType] = useNodeState<string>(id, 'inputType', '');
  const [fileName, setFileName] = useNodeState<string>(id, 'fileName', '');
  
  const [runMode, setRunMode] = useNodeState(id, 'runMode', 'single');
  const [initialCash, setInitialCash] = useNodeState(id, 'initialCash', '100000');
  const [startDate, setStartDate] = useNodeState(id, 'startDate', threeMonthsAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useNodeState(id, 'endDate', today.toISOString().split('T')[0]);
  
  const [open, setOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { currentFlowId } = useFlowContext();
  const nodeContext = useNodeContext();
  const { getAllAgentModels } = nodeContext;
  const { getNodes, getEdges } = useReactFlow();
  const { expandBottomPanel, setBottomPanelTab } = useLayoutContext();
  
  const flowId = currentFlowId?.toString() || null;
  const {
    isConnecting,
    isConnected,
    isProcessing,
    canRun,
    runFlow,
    runBacktest,
    stopFlow,
    recoverFlowState
  } = useFlowConnection(flowId);
  
  const canRunHedgeFund = canRun && (tickers.length > 0 || portfolioPositions.length > 0);
  
  useKeyboardShortcuts({
    shortcuts: [
      {
        key: 'Enter',
        ctrlKey: true,
        metaKey: true,
        callback: () => {
          if (canRunHedgeFund) {
            handlePlay();
          }
        },
        preventDefault: true,
      },
    ],
  });
  
  useEffect(() => {
    if (flowId) {
      recoverFlowState();
    }
  }, [flowId, recoverFlowState]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsUploading(true);
    setUploadError(null);
    setTickers([]);
    setPortfolioPositions([]);
    setInputType('');

    try {
      const result = await api.uploadFile(file);
      if (result.type === 'portfolio') {
        setInputType('portfolio');
        setPortfolioPositions(result.positions || []);
        setTickers(result.positions.map((p: ParsedPosition) => p.ticker));
      } else {
        setInputType('stock');
        setTickers(result.tickers || []);
      }
    } catch (error: unknown) {
      console.error('File upload error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to parse file';
      setUploadError(errorMessage);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleInitialCashChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numericValue = e.target.value.replace(/[^0-9.]/g, '');
    setInitialCash(numericValue);
  };

  const formatCurrency = (value: string) => {
    if (!value) return '';
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    return num.toLocaleString('en-US');
  };

  const handleStop = () => {
    stopFlow();
  };

  const handlePlay = () => {
    expandBottomPanel();
    setBottomPanelTab('output');
    
    const allNodes = getNodes();
    const allEdges = getEdges();
    
    const reachableNodes = new Set<string>();
    const visited = new Set<string>();
    
    const dfs = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      
      if (nodeId !== id) {
        reachableNodes.add(nodeId);
      }
      
      const outgoingEdges = allEdges.filter(edge => edge.source === nodeId);
      for (const edge of outgoingEdges) {
        dfs(edge.target);
      }
    };
    
    dfs(id);
    
    const agentNodes = allNodes.filter(node => reachableNodes.has(node.id));
    const reachableNodeIds = new Set([id, ...reachableNodes]);
    const validEdges = allEdges.filter(edge => 
      reachableNodeIds.has(edge.source) && reachableNodeIds.has(edge.target)
    );

    const agentModels: { agent_id: string; model_name: string; model_provider: ModelProvider }[] = [];
    const allAgentModels = getAllAgentModels(flowId);
    for (const node of agentNodes) {
      const model = allAgentModels[node.id];
      if (model) {
        agentModels.push({
          agent_id: node.id,
          model_name: model.model_name,
          model_provider: model.provider as ModelProvider
        });
      }
    }
    
    let processedPositions = undefined;
    if (inputType === 'portfolio') {
      processedPositions = portfolioPositions.map((pos: ParsedPosition) => ({
        ticker: pos.ticker,
        quantity: parseFloat(String(pos.quantity)) || 0,
        trade_price: parseFloat(String(pos.tradePrice || pos.trade_price || pos.price)) || 0
      }));
    }
    
    if (runMode === 'backtest') {
      runBacktest({
        tickers: tickers,
        graph_nodes: agentNodes.map(node => ({
          id: node.id,
          type: node.type,
          data: node.data,
          position: node.position
        })),
        graph_edges: validEdges,
        agent_models: agentModels,
        start_date: startDate,
        end_date: endDate,
        initial_capital: parseFloat(initialCash) || 100000,
        margin_requirement: 0.0,
        model_name: undefined,
        model_provider: undefined,
        portfolio_positions: processedPositions,
      });
    } else {
      runFlow({
        tickers: tickers,
        graph_nodes: agentNodes.map(node => ({
          id: node.id,
          type: node.type,
          data: node.data,
          position: node.position
        })),
        graph_edges: validEdges,
        agent_models: agentModels,
        model_name: undefined,
        model_provider: undefined,
        start_date: startDate,
        end_date: endDate,
        initial_cash: parseFloat(initialCash) || 100000,
        portfolio_positions: processedPositions,
      });
    }
  };

  const showAsProcessing = isConnecting || isConnected || isProcessing;

  return (
    <TooltipProvider>
      <NodeShell
        id={id}
        selected={selected}
        isConnectable={isConnectable}
        icon={<FileText className="h-5 w-5" />}
        name={data?.name || "File Input"}
        description={data?.description}
        hasLeftHandle={false}
        hasRightHandle={true}
        width="w-80"
      >
        <CardContent className="p-0">
          <div className="border-t border-border p-3">
            <div className="flex flex-col gap-4">
              
              {/* File Upload Section */}
              <div className="flex flex-col gap-2">
                <div className="text-subtitle text-primary flex items-center gap-1">
                  Input File
                </div>
                
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".pdf,.png,.jpg,.jpeg,.csv,.txt"
                  onChange={handleFileChange}
                />
                
                <Button 
                  variant="outline" 
                  className="w-full h-20 border-dashed flex flex-col gap-1 items-center justify-center bg-node hover:bg-accent"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Parsing with OpenAI...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Click to upload file</span>
                      <span className="text-[10px] text-muted-foreground/70">PDF, Image, CSV, TXT</span>
                    </>
                  )}
                </Button>

                {fileName && !isUploading && !uploadError && (
                  <div className="flex flex-col gap-1 mt-1 p-2 bg-accent/50 rounded-md border border-border/50">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span className="truncate">{fileName}</span>
                    </div>
                    {inputType === 'portfolio' ? (
                      <div className="text-xs text-muted-foreground pl-6">
                        Portfolio parsed: {portfolioPositions.length} positions
                      </div>
                    ) : inputType === 'stock' ? (
                      <div className="text-xs text-muted-foreground pl-6">
                        Stocks parsed: {tickers.join(', ')}
                      </div>
                    ) : null}
                  </div>
                )}
                
                {uploadError && (
                  <div className="text-xs text-destructive mt-1">
                    Error: {uploadError}
                  </div>
                )}
              </div>

              {/* Run Section */}
              <div className="flex flex-col gap-2">
                <div className="text-subtitle text-primary flex items-center gap-1">
                  Run
                </div>
                <div className="flex gap-2">
                  <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="flex-1 justify-between h-10 px-3 py-2 bg-node border border-border hover:bg-accent"
                      >
                        <span className="text-subtitle">
                          {runModes.find((mode) => mode.value === runMode)?.label || 'Single Run'}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 bg-node border border-border shadow-lg">
                      <Command className="bg-node">
                        <CommandList className="bg-node">
                          <CommandEmpty>No run mode found.</CommandEmpty>
                          <CommandGroup>
                            {runModes.map((mode) => (
                              <CommandItem
                                key={mode.value}
                                value={mode.value}
                                className={cn(
                                  "cursor-pointer bg-node hover:bg-accent",
                                  runMode === mode.value
                                )}
                                onSelect={(currentValue) => {
                                  setRunMode(currentValue);
                                  setOpen(false);
                                }}
                              >
                                {mode.label}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <Button 
                    size="icon" 
                    variant="secondary"
                    className="flex-shrink-0 transition-all duration-200 hover:bg-primary hover:text-primary-foreground active:scale-95"
                    title={showAsProcessing ? "Stop" : `Run (${formatKeyboardShortcut('↵')})`}
                    onClick={showAsProcessing ? handleStop : handlePlay}
                    disabled={!canRunHedgeFund && !showAsProcessing}
                  >
                    {showAsProcessing ? (
                      <Square className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Advanced Settings */}
              {runMode === 'backtest' && (
                <Accordion type="single" collapsible>
                  <AccordionItem value="advanced" className="border-none">
                    <AccordionTrigger className="!text-subtitle text-primary">
                      Advanced
                    </AccordionTrigger>
                    <AccordionContent className="pt-2">
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                          <div className="text-subtitle text-primary flex items-center gap-1">
                            Available Cash
                          </div>
                          <div className="relative flex-1">
                            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground pointer-events-none">
                              $
                            </div>
                            <Input
                              type="text"
                              placeholder="100,000"
                              value={formatCurrency(initialCash)}
                              onChange={handleInitialCashChange}
                              className="pl-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <div className="text-subtitle text-primary flex items-center gap-1">
                            Start Date
                          </div>
                          <Input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <div className="text-subtitle text-primary flex items-center gap-1">
                            End Date
                          </div>
                          <Input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                          />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
              {runMode === 'single' && (
                <Accordion type="single" collapsible>
                  <AccordionItem value="advanced" className="border-none">
                    <AccordionTrigger className="!text-subtitle text-primary">
                      Advanced
                    </AccordionTrigger>
                    <AccordionContent className="pt-2">
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                          <div className="text-subtitle text-primary flex items-center gap-1">
                            Start Date
                          </div>
                          <Input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <div className="text-subtitle text-primary flex items-center gap-1">
                            End Date
                          </div>
                          <Input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                          />
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </div>
          </div>
        </CardContent>
      </NodeShell>
    </TooltipProvider>
  );
}
