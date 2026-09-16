/**
 * Route assembly.
 *
 * Auth gating is per router, not a global middleware with a path exception. The
 * spec's "auth gates everything except /api/auth/*" is very nearly right, but
 * POST /auth/logout needs req.user — so a blanket prefix exemption would leave the
 * one authenticated auth route unauthenticated. Mounting requireAuth on each
 * router, and on logout specifically, makes the exception impossible to get wrong.
 *
 * Multipart is confined to the one route that needs it, with an explicit size cap
 * and type allowlist: an unbounded upload endpoint on a free instance is a trivial
 * denial of service.
 */
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config/index.js';
import { unsupportedMediaType } from '../errors.js';
import type { AppDeps } from '../ports.js';
import { requireAuth } from '../middlewares/auth.middleware.js';
import { idempotency, replayFinders } from '../middlewares/idempotency.middleware.js';
import {
  authLimiter,
  createVisionQuota,
  photoScanLimiter,
  searchLimiter,
  standardLimiter,
} from '../middlewares/rate-limit.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  bodyMeasurementInputSchema,
  credentialsSchema,
  customFoodInputSchema,
  exerciseQuerySchema,
  foodLogInputSchema,
  foodLogQuerySchema,
  idParamSchema,
  nutritionSearchQuerySchema,
  overviewQuerySchema,
  onboardingSchema,
  pushSubscriptionSchema,
  refreshSchema,
  routineInputSchema,
  routineUpdateSchema,
  trendQuerySchema,
  userUpdateSchema,
  workoutLogInputSchema,
} from '../validation/index.js';
import { makeAuthController } from '../controllers/auth.controller.js';
import { makeBillingController } from '../controllers/billing.controller.js';
import { makeBodyCompositionController } from '../controllers/body-composition.controller.js';
import { makeCustomFoodsController } from '../controllers/custom-foods.controller.js';
import { makeNotificationsController } from '../controllers/notifications.controller.js';
import { makeNutritionController } from '../controllers/nutrition.controller.js';
import { makeOverviewController } from '../controllers/overview.controller.js';
import { makeTrainingController } from '../controllers/training.controller.js';
import { makeUsersController } from '../controllers/users.controller.js';
import { makeWorkoutLogsController } from '../controllers/workout-logs.controller.js';

/**
 * Memory storage, not disk: the host filesystem is ephemeral, and more to the
 * point the image must never be written anywhere. It lives as a Buffer for the
 * duration of the request and is then discarded.
 */
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.photoMaxBytes, files: 1, fields: 4 },
  fileFilter: (_req, file, callback) => {
    const allowed: readonly string[] = config.uploads.allowedImageTypes;
    if (!allowed.includes(file.mimetype)) {
      callback(unsupportedMediaType(`${file.mimetype} is not a supported image type.`));
      return;
    }
    callback(null, true);
  },
});

export function createRouter(deps: AppDeps): Router {
  const router = Router();
  const auth = requireAuth(deps);
  const visionQuota = createVisionQuota(deps.clock);

  const authController = makeAuthController(deps);
  const users = makeUsersController();
  const training = makeTrainingController();
  const workoutLogs = makeWorkoutLogsController();
  const nutrition = makeNutritionController(deps, visionQuota);
  const customFoods = makeCustomFoodsController();
  const bodyComposition = makeBodyCompositionController(deps);
  const overview = makeOverviewController(deps);
  const billing = makeBillingController();
  const notifications = makeNotificationsController();

  // -------------------------------------------------------------------------
  // /auth — the only unauthenticated routes, except logout.
  // -------------------------------------------------------------------------
  const authRouter = Router();
  authRouter.post('/register', authLimiter, validate(credentialsSchema), authController.register);
  authRouter.post('/login', authLimiter, validate(credentialsSchema), authController.login);
  authRouter.post('/refresh', authLimiter, validate(refreshSchema), authController.refresh);
  // Authenticated, unlike its siblings: it needs to know whose session to end.
  authRouter.post('/logout', auth, authController.logout);
  router.use('/auth', authRouter);

  // -------------------------------------------------------------------------
  // Everything below requires a valid session.
  // -------------------------------------------------------------------------
  const usersRouter = Router();
  usersRouter.use(auth, standardLimiter);
  usersRouter.get('/me', users.me);
  usersRouter.put('/me', validate(userUpdateSchema), users.update);
  usersRouter.post('/me/onboarding', validate(onboardingSchema), users.onboarding);
  router.use('/users', usersRouter);

  const exercisesRouter = Router();
  exercisesRouter.use(auth, standardLimiter);
  exercisesRouter.get('/', validate(exerciseQuerySchema, 'query'), training.exercises);
  router.use('/exercises', exercisesRouter);

  const routinesRouter = Router();
  routinesRouter.use(auth, standardLimiter);
  routinesRouter.get('/', training.routines);
  routinesRouter.post('/', validate(routineInputSchema), training.create);
  routinesRouter.put(
    '/:id',
    validate(idParamSchema, 'params'),
    validate(routineUpdateSchema),
    training.update,
  );
  routinesRouter.delete('/:id', validate(idParamSchema, 'params'), training.remove);
  router.use('/routines', routinesRouter);

  const workoutLogsRouter = Router();
  workoutLogsRouter.use(auth, standardLimiter);
  workoutLogsRouter.get('/', workoutLogs.list);
  workoutLogsRouter.post(
    '/',
    validate(workoutLogInputSchema),
    // Fast path for a replayed offline write; the unique constraint is the guarantee.
    idempotency(replayFinders.workoutLog),
    workoutLogs.create,
  );
  router.use('/workout-logs', workoutLogsRouter);

  const nutritionRouter = Router();
  nutritionRouter.use(auth, standardLimiter);
  nutritionRouter.get(
    '/search',
    searchLimiter,
    validate(nutritionSearchQuerySchema, 'query'),
    nutrition.search,
  );
  nutritionRouter.get('/custom-foods', customFoods.list);
  nutritionRouter.post(
    '/custom-foods',
    validate(customFoodInputSchema),
    idempotency(replayFinders.customFood),
    customFoods.create,
  );
  nutritionRouter.get('/log', validate(foodLogQuerySchema, 'query'), nutrition.dailyLog);
  nutritionRouter.post(
    '/log',
    validate(foodLogInputSchema),
    idempotency(replayFinders.foodLog),
    nutrition.log,
  );
  nutritionRouter.delete('/log/:id', validate(idParamSchema, 'params'), nutrition.removeEntry);
  nutritionRouter.post(
    '/scan-photo',
    photoScanLimiter,
    photoUpload.single('photo'),
    nutrition.scanPhoto,
  );
  router.use('/nutrition', nutritionRouter);

  const bodyCompRouter = Router();
  bodyCompRouter.use(auth, standardLimiter);
  bodyCompRouter.get('/', bodyComposition.list);
  bodyCompRouter.post(
    '/entry',
    validate(bodyMeasurementInputSchema),
    idempotency(replayFinders.bodyMeasurement),
    bodyComposition.create,
  );
  bodyCompRouter.get('/trend', validate(trendQuerySchema, 'query'), bodyComposition.trend);
  bodyCompRouter.get('/evaluation', bodyComposition.evaluation);
  router.use('/body-composition', bodyCompRouter);

  const overviewRouter = Router();
  overviewRouter.use(auth, standardLimiter);
  overviewRouter.get('/', validate(overviewQuerySchema, 'query'), overview.summary);
  router.use('/overview', overviewRouter);

  const billingRouter = Router();
  billingRouter.use(auth, standardLimiter);
  billingRouter.get('/status', billing.status);
  billingRouter.get('/premium-teaser', billing.premiumTeaser);
  router.use('/billing', billingRouter);

  const notificationsRouter = Router();
  notificationsRouter.use(auth, standardLimiter);
  notificationsRouter.post('/subscribe', validate(pushSubscriptionSchema), notifications.subscribe);
  router.use('/notifications', notificationsRouter);

  return router;
}
