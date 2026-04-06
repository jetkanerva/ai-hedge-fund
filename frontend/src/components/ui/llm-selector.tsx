import { ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { type LanguageModel } from "@/data/models"

interface ModelSelectorProps {
  models: LanguageModel[];
  value: string;
  onChange: (item: LanguageModel | null) => void;
  placeholder?: string;
}

export function ModelSelector({ 
  models: _models, 
  value: _value, 
  onChange: _onChange, 
  placeholder: _placeholder = "GPT-5.4" 
}: ModelSelectorProps) {
  return (
    <Button
      variant="outline"
      role="combobox"
      className="w-full justify-between bg-node border border-border opacity-70 cursor-not-allowed"
      disabled={true}
    >
      <span className="text-subtitle">
        GPT-5.4
      </span>
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </Button>
  )
} 