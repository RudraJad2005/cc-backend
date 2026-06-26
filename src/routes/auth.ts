import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.post('/verify', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    status: 'success',
    user: req.user
  });
});

export default router;
