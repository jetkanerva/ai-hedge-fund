import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xkiqrchoebnjrdqhqcjn.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhraXFyY2hvZWJuanJkcWhxY2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NTgxMjQsImV4cCI6MjA5MTAzNDEyNH0.ovMQC93ks1n74-OxuSPRj3I2SskljJWYVHBoUwtwYII';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
