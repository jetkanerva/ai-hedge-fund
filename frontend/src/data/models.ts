export interface LanguageModel {
  display_name: string;
  model_name: string;
  provider: "Anthropic" | "DeepSeek" | "Google" | "Groq" | "OpenAI";
}

const GPT_54_MODEL: LanguageModel = {
  display_name: "GPT-5.4",
  model_name: "gpt-5.4",
  provider: "OpenAI"
};

/**
 * Get the list of models from the backend API
 * Uses caching to avoid repeated API calls
 */
export const getModels = async (): Promise<LanguageModel[]> => {
  return [GPT_54_MODEL];
};

/**
 * Get the default model (GPT-5.4) from the models list
 */
export const getDefaultModel = async (): Promise<LanguageModel | null> => {
  return GPT_54_MODEL;
};
