import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/services/api';
import { toast } from 'sonner';

export function OrganizationSettings() {
  const { dbUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const data = await api.getOrganizationUsers();
      setUsers(data);
    } catch (error: any) {
      toast.error('Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserEmail.trim()) {
      toast.error('Please enter an email address');
      return;
    }

    try {
      setIsAdding(true);
      await api.addUserToOrganization(newUserEmail);
      toast.success('User added successfully!');
      setNewUserEmail('');
      await fetchUsers();
    } catch (error: any) {
      toast.error(error.message || 'Failed to add user');
    } finally {
      setIsAdding(false);
    }
  };

  if (!dbUser) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Organization</h2>
        <p className="text-muted-foreground">
          Manage your organization and team members.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organization Details</CardTitle>
          <CardDescription>
            Your current organization and role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <div className="flex justify-between py-2 border-b">
              <span className="font-medium">Name:</span>
              <span className="text-muted-foreground">{dbUser.organization?.name || 'N/A'}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="font-medium">Your Role:</span>
              <span className="text-muted-foreground capitalize">{dbUser.role}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {dbUser.role === 'admin' && (
        <Card>
          <CardHeader>
            <CardTitle>Add Team Member</CardTitle>
            <CardDescription>
              Invite a new user to your organization. They must sign in with this email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddUser} className="flex gap-4 items-end">
              <div className="flex flex-col gap-2 flex-1">
                <label htmlFor="email" className="text-sm font-medium">Email Address</label>
                <Input
                  id="email"
                  type="email"
                  placeholder="colleague@example.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  disabled={isAdding}
                />
              </div>
              <Button type="submit" disabled={isAdding}>
                {isAdding ? 'Adding...' : 'Add User'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
          <CardDescription>
            People who have access to this organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-4 text-center text-muted-foreground">Loading members...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell className="capitalize">{u.role}</TableCell>
                    <TableCell>{new Date(u.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}