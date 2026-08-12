import type { Role } from '@prisma/client';
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
      clientId: string | null;
      storeId: string | null;
      employeeId: string | null;
      mustChangePassword: boolean;
    } & DefaultSession['user'];
  }

  interface User {
    id: string;
    role: Role;
    clientId: string | null;
    storeId: string | null;
    employeeId: string | null;
    mustChangePassword: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: Role;
    clientId: string | null;
    storeId: string | null;
    employeeId: string | null;
    mustChangePassword: boolean;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string;
    role: Role;
    clientId: string | null;
    storeId: string | null;
    employeeId: string | null;
    mustChangePassword: boolean;
  }
}

