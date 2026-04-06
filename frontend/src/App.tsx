import { Layout } from './components/Layout';
import { Toaster } from './components/ui/sonner';
import { useAuth } from './contexts/auth-context';
import { Login } from './components/login';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex h-screen w-full items-center justify-center bg-background">Loading...</div>;
  }

  if (!user || user.email !== "jeti.kanerva@gmail.com") {
    return <Login />;
  }

  return (
    <>
      <Layout />
      <Toaster />
    </>
  );
}
