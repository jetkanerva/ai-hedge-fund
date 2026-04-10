import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { api } from '@/services/api';

export interface DbUser {
  id: number;
  email: string;
  role: string;
  organization_id: number;
  organization?: {
    id: number;
    name: string;
  };
}

interface AuthContextType {
  user: User | null;
  dbUser: DbUser | null;
  session: Session | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshDbUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<DbUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDbUser = async (sessionUser: User | null) => {
    if (!sessionUser) {
      setDbUser(null);
      return;
    }
    try {
      const dbUserData = await api.getCurrentUser();
      setDbUser(dbUserData);
    } catch (error) {
      console.error('Error fetching DB user:', error);
      setDbUser(null);
    }
  };

  const refreshDbUser = async () => {
    await fetchDbUser(user);
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      await fetchDbUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      await fetchDbUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    // Use environment variable if provided, otherwise use current origin
    // Note: The URL must be added to Supabase Dashboard > Authentication > URL Configuration
    const redirectTo = window.location.origin;
    
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
      },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, dbUser, session, loading, signInWithGoogle, signOut, refreshDbUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

