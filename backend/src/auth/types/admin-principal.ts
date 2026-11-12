export interface AdminPrincipal {
  id: number;
  email: string;
  role: "ADMIN";
  sessionId: string;
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  role: "ADMIN";
  email: string;
  jti: string;
}

export interface AdminProfile {
  id: number;
  email: string;
  role: "ADMIN";
}
