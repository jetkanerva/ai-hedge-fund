import { supabase } from '@/lib/supabase';

export const getAuthHeaders = async (): Promise<HeadersInit> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    return {
      'Authorization': `Bearer ${session.access_token}`
    };
  }
  return {};
};

export const authFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const headers = await getAuthHeaders();
  
  const modifiedInit: RequestInit = {
    ...init,
    headers: {
      ...init?.headers,
      ...headers,
    },
  };

  return fetch(input, modifiedInit);
};
