import { Request, Response, NextFunction } from 'express';
import { logger } from '../logger';
import { supabase } from '../utils/supabase';

// Extend Express Request type to include user information
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
  };
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<any> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header. Must be Bearer <token>' });
  }

  const token = authHeader.split(' ')[1];

  // 1. Check for mock/dev token first for quick testing (Only in dev)
  if (process.env.NODE_ENV === 'development' && process.env.DEV_MOCK_TOKEN && token === process.env.DEV_MOCK_TOKEN) {
    req.user = {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'dev@collabcode.dev'
    };
    return next();
  }

  try {
    // 2. Try verifying as a Supabase JWT (user access token)
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (!authError && authData.user) {
      req.user = {
        id: authData.user.id,
        email: authData.user.email
      };
      return next();
    }

    // 3. Try verifying as an API Key from the public.api_keys table
    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('user_id')
      .eq('key', token)
      .maybeSingle();

    if (!keyError && keyData) {
      req.user = {
        id: keyData.user_id
      };
      return next();
    }

    return res.status(401).json({ error: 'Invalid API Token or Session Expired' });
  } catch (err: any) {
    logger.error('Auth middleware error:', err.message);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
}
