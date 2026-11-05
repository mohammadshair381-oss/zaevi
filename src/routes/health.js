import { Router } from 'express';
import { checkDatabaseHealth } from '../db/connect.js';

const router = Router();

/**
 * GET /api/health
 *
 * Reports service liveness and database readiness. The service is only
 * considered healthy when a live database probe succeeds; otherwise a 503 is
 * returned so an unavailable database cannot appear healthy. The probe is
 * time-boxed so the endpoint stays responsive when the database is unreachable.
 */
router.get('/health', async (req, res) => {
  const database = await checkDatabaseHealth();
  const healthy = database.status === 'connected';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'zaevi-backend',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    database,
  });
});

export default router;
