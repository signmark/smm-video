import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store';

export const AdminDebugger = () => {
  const token = useAuthStore((state) => state.token);
  
  const { data: adminData, isLoading, error } = useQuery({
    queryKey: ['/api/users/is-admin', token],
    queryFn: async () => {
      console.log('🔍 AdminDebugger: Fetching admin status with token:', token?.substring(0, 20) + '...');
      
      if (!token) {
        console.log('🔍 AdminDebugger: No token found');
        return { isAdmin: false };
      }
      
      const response = await fetch('/api/users/is-admin', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      console.log('🔍 AdminDebugger: Response status:', response.status);
      
      if (!response.ok) {
        console.log('🔍 AdminDebugger: Response not ok:', response.status, response.statusText);
        return { isAdmin: false };
      }
      
      const data = await response.json();
      console.log('🔍 AdminDebugger: Response data:', data);
      
      return data;
    },
    enabled: !!token,
    staleTime: 0, // No cache
    refetchOnMount: true
  });
  
  console.log('🔍 AdminDebugger: Current state:', { adminData, isLoading, error, token: !!token });
  
  const isAdmin = adminData?.isAdmin || false;
  
  return (
    <div className="fixed bottom-4 right-4 bg-black text-white p-4 rounded-lg shadow-lg max-w-sm z-50">
      <h3 className="font-bold mb-2">🔧 Admin Debug</h3>
      <div className="text-xs space-y-1">
        <div><strong>Token:</strong> {token ? 'Present' : 'Missing'}</div>
        <div><strong>Loading:</strong> {isLoading ? 'Yes' : 'No'}</div>
        <div><strong>Error:</strong> {error ? 'Yes' : 'No'}</div>
        <div><strong>AdminData:</strong> {JSON.stringify(adminData)}</div>
        <div className="mt-2 p-2 bg-gray-800 rounded">
          <strong className={isAdmin ? 'text-green-400' : 'text-red-400'}>
            IS ADMIN: {isAdmin ? 'YES' : 'NO'}
          </strong>
        </div>
      </div>
    </div>
  );
};