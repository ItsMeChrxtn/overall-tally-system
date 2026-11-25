import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { protect, authorize } from '../middleware/auth.js';
import { imageUpload } from '../middleware/upload.js';
import { ROLES } from '../constants/index.js';

import * as auth from '../controllers/authController.js';
import * as users from '../controllers/userController.js';
import * as settings from '../controllers/settingController.js';
import * as events from '../controllers/eventController.js';
import * as assignments from '../controllers/assignmentController.js';
import * as categories from '../controllers/categoryController.js';
import * as criteria from '../controllers/criterionController.js';
import * as contestants from '../controllers/contestantController.js';
import * as judging from '../controllers/judgingController.js';
import * as sheets from '../controllers/sheetController.js';
import * as tally from '../controllers/tallyController.js';
import * as pub from '../controllers/publicController.js';
import * as dashboard from '../controllers/dashboardController.js';
import * as misc from '../controllers/miscController.js';
import * as reports from '../controllers/reportController.js';

const { SUPER_ADMIN, EVENT_ADMIN, JUDGE, TABULATOR } = ROLES;
const STAFF = [SUPER_ADMIN, EVENT_ADMIN, TABULATOR];
const ADMINS = [SUPER_ADMIN, EVENT_ADMIN];

const router = Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, message: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' } });
const coverUpload = imageUpload('events');
const photoUpload = imageUpload('contestants');

// ---------- Public (no account) ----------
router.get('/public/settings', settings.getPublicSettings);
router.get('/public/events', pub.publicEvents);
router.get('/public/events/:id', pub.publicEvent);

// ---------- Auth ----------
router.post('/auth/login', authLimiter, auth.login);
router.post('/auth/forgot-password', authLimiter, auth.forgotPassword);
router.post('/auth/reset-password/:token', authLimiter, auth.resetPassword);
router.get('/auth/me', protect, auth.me);
router.post('/auth/logout', protect, auth.logout);
router.post('/auth/change-password', protect, auth.changePassword);
router.patch('/auth/profile', protect, auth.updateProfile);

// Everything below requires a valid session
router.use(protect);

router.get('/dashboard', dashboard.getDashboard);
router.get('/notifications', misc.listNotifications);
router.patch('/notifications/read-all', misc.markAllRead);
router.patch('/notifications/:id/read', misc.markNotificationRead);

// ---------- Users & settings ----------
router.get('/users', authorize(...ADMINS), users.listUsers);
router.post('/users', authorize(...ADMINS), users.createUser);
router.get('/users/:id', authorize(...ADMINS), users.getUser);
router.patch('/users/:id', authorize(...ADMINS), users.updateUser);
router.patch('/users/:id/status', authorize(...ADMINS), users.setUserStatus);
router.post('/users/:id/reset-password', authorize(...ADMINS), users.adminResetPassword);

router.get('/settings', authorize(SUPER_ADMIN), settings.getSettings);
router.put('/settings', authorize(SUPER_ADMIN), settings.updateSettings);

router.get('/audit-logs', authorize(...ADMINS), misc.listAuditLogs);

// ---------- Events ----------
router.get('/events', authorize(...STAFF), events.listEvents);
router.post('/events', authorize(...ADMINS), events.createEvent);
router.get('/events/:id', authorize(...STAFF, JUDGE), events.getEvent);
router.patch('/events/:id', authorize(...ADMINS), events.updateEvent);
router.patch('/events/:id/status', authorize(...ADMINS), events.setEventStatus);
router.post('/events/:id/archive', authorize(...ADMINS), events.archiveEvent);
router.post('/events/:id/restore', authorize(SUPER_ADMIN), events.restoreEvent);
router.delete('/events/:id', authorize(SUPER_ADMIN), events.deleteEvent);
router.post('/events/:id/cover', authorize(...ADMINS), coverUpload.single('image'), events.uploadCover);

router.get('/events/:eventId/assignments', authorize(...STAFF), assignments.listAssignments);
router.post('/events/:eventId/assignments', authorize(...ADMINS), assignments.createAssignment);
router.post('/events/:eventId/encode-judges', authorize(...ADMINS), assignments.createEncodeJudge);
router.patch('/assignments/:id', authorize(...ADMINS), assignments.updateAssignment);
router.put('/assignments/:id/judge-login', authorize(...ADMINS), assignments.setJudgeLogin);
router.delete('/assignments/:id', authorize(...ADMINS), assignments.deleteAssignment);

// ---------- Categories, criteria, scoring configuration ----------
router.get('/events/:eventId/categories', authorize(...STAFF), categories.listCategories);
router.post('/events/:eventId/categories', authorize(...ADMINS), categories.createCategory);
router.get('/categories/:id', authorize(...STAFF), categories.getCategory);
router.patch('/categories/:id', authorize(...ADMINS), categories.updateCategory);
router.delete('/categories/:id', authorize(...ADMINS), categories.deleteCategory);
router.put('/categories/:id/contestants', authorize(...ADMINS), categories.setCategoryContestants);
router.put('/categories/:id/judges', authorize(...ADMINS), categories.setCategoryJudges);
router.get('/categories/:id/config-check', authorize(...STAFF), categories.configCheck);
router.post('/categories/:id/lock', authorize(...ADMINS), categories.lockCategory);
router.post('/categories/:id/reopen-config', authorize(...ADMINS), categories.reopenCategoryConfig);
router.post('/categories/:id/close-scoring', authorize(...ADMINS), categories.setScoringOpen(false));
router.post('/categories/:id/reopen-scoring', authorize(...ADMINS), categories.setScoringOpen(true));
router.post('/categories/:id/copy-criteria', authorize(...ADMINS), categories.copyCriteria);

router.get('/categories/:categoryId/criteria', authorize(...STAFF), criteria.listCriteria);
router.post('/categories/:categoryId/criteria', authorize(...ADMINS), criteria.createCriterion);
router.put('/categories/:categoryId/criteria/reorder', authorize(...ADMINS), criteria.reorderCriteria);
router.patch('/criteria/:id', authorize(...ADMINS), criteria.updateCriterion);
router.delete('/criteria/:id', authorize(...ADMINS), criteria.deleteCriterion);

// ---------- Contestants ----------
router.get('/events/:eventId/contestants', authorize(...STAFF), contestants.listContestants);
router.post('/events/:eventId/contestants', authorize(...ADMINS), contestants.createContestant);
router.patch('/contestants/:id', authorize(...ADMINS), contestants.updateContestant);
router.delete('/contestants/:id', authorize(...ADMINS), contestants.deleteContestant);
router.post('/contestants/:id/photo', authorize(...ADMINS), photoUpload.single('image'), contestants.uploadPhoto);

// ---------- Judge portal ----------
router.get('/judging/assignments', authorize(JUDGE), judging.myAssignments);
router.get('/judging/history', authorize(JUDGE), judging.myHistory);
router.get('/judging/categories/:id', authorize(JUDGE), judging.getJudgeCategory);
router.put('/judging/categories/:id/sheets/:contestantId', authorize(JUDGE), judging.saveDraft);
router.post('/judging/categories/:id/sheets/:contestantId/submit', authorize(JUDGE), judging.submitSheet);
router.post('/judging/categories/:id/submit-all', authorize(JUDGE), judging.submitAll);

// ---------- Score encoding (the event admin enters each judge's paper scores) ----------
router.get('/categories/:id/encode', authorize(...ADMINS), judging.getEncodeCategory);
router.put('/categories/:id/encode/:judgeId/sheets/:contestantId', authorize(...ADMINS), judging.encodeSaveDraft);
router.post('/categories/:id/encode/:judgeId/submit-all', authorize(...ADMINS), judging.encodeSubmitAll);

// ---------- Score sheets (staff) ----------
router.get('/categories/:id/sheets', authorize(...STAFF), sheets.listCategorySheets);
router.get('/categories/:id/progress', authorize(...STAFF), sheets.categoryProgress);
router.get('/sheets/:id', authorize(...STAFF), sheets.getSheet);
router.post('/sheets/:id/reopen', authorize(...ADMINS), sheets.reopenSheet);

// ---------- Tabulation & approval ----------
router.get('/categories/:id/tally', authorize(...STAFF), tally.liveCategoryTally);
router.get('/categories/:id/results', authorize(...STAFF), tally.listCategoryResults);
router.post('/categories/:id/results', authorize(...STAFF), tally.generateCategoryResult);
router.get('/events/:eventId/overall', authorize(...STAFF), tally.liveOverallTally);
router.post('/events/:eventId/overall/results', authorize(...STAFF), tally.generateOverallResult);
router.get('/events/:eventId/results', authorize(...STAFF), tally.listEventResults);
router.get('/results/:id', authorize(...STAFF), tally.getResult);
router.post('/results/:id/finalize', authorize(...ADMINS), tally.transition('finalize'));
router.post('/results/:id/submit', authorize(...STAFF), tally.transition('submit'));
router.post('/results/:id/approve', authorize(...ADMINS), tally.transition('approve'));
router.post('/results/:id/return', authorize(...ADMINS), tally.transition('return'));
router.post('/results/:id/publish', authorize(...ADMINS), tally.transition('publish'));
router.post('/results/:id/unpublish', authorize(...ADMINS), tally.transition('unpublish'));

// ---------- Reports ----------
router.get('/reports/types', authorize(...STAFF), reports.reportTypes);
router.get('/reports/:eventId/:type', authorize(...STAFF), reports.getReport);

export default router;
