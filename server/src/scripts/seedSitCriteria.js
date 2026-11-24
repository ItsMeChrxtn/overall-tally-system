/**
 * Loads the SIT 2026 competitions and their judging criteria WITHOUT wiping data.
 * Safe to re-run: existing events/categories are reused, and a category that already
 * has criteria (or is locked) is left untouched.
 *
 *   npm run seed:sit                       (owner = first active Super Admin)
 *   npm run seed:sit -- --owner you@example.com
 */
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import Event from '../models/Event.js';
import Category from '../models/Category.js';
import Criterion from '../models/Criterion.js';
import { audit } from '../services/auditService.js';

// Criterion tuple: [name, weight (%), maxScore, description]
// For percentage rubrics the max score equals the weight, so judges enter points
// directly (e.g. Musicality 0–30) and the weighted total is out of 100.
const pct = (name, weight, description) => [name, weight, weight, description];

const PRESENTATION = [
  pct('Content Mastery', 20),
  pct('Organization and Flow', 15),
  pct('Clarity of Explanation', 15),
  pct('Delivery and Confidence', 15),
  pct('Visual Aids / Slides', 10),
  pct('Research Significance and Insight', 10),
  pct('Time Management', 5),
  pct('Response to Questions', 10),
];

const FILM_RUBRIC =
  'Rubric per criterion (max 20): Exemplary 16–20 · Proficient 11–15 · Partially Proficient 6–10 · Incomplete 1–5.';

const EVENTS = [
  {
    name: 'Battle of the Band',
    eventType: 'talent',
    categories: [
      {
        name: 'Battle of the Band',
        scoringMethod: 'weighted',
        instructions: 'Score each criterion up to its percentage (e.g. Musicality 0–30). Total is out of 100.',
        criteria: [
          pct('Musicality', 30, 'Instrumental skills, rhythm, timing, precision, and overall sound quality.'),
          pct('Stage Presence and Showmanship', 25, 'Confidence, energy, audience engagement, and stage movement.'),
          pct('Vocal Quality', 20, 'Pitch, tone, vocal control, clarity, and expression.'),
          pct('Originality and Creativity', 15, 'Unique interpretation, musical arrangement, and creativity in performance.'),
          pct('Overall Performance and Audience Impact', 10, 'Band chemistry, entertainment value, and overall impression.'),
        ],
      },
    ],
  },
  {
    name: 'SIT Idols',
    eventType: 'talent',
    categories: [
      {
        name: 'SIT Idols',
        scoringMethod: 'weighted',
        instructions: 'Score each criterion up to its percentage (e.g. Talent 0–35). Total is out of 100.',
        criteria: [
          pct('Talent and Technical Execution', 35, 'Demonstrates mastery, accuracy, coordination, and proficiency in the chosen talent.'),
          pct('Creativity and Originality', 25, 'Demonstrates innovation, uniqueness, artistic interpretation, and originality of presentation.'),
          pct('Stage Presence and Confidence', 20, 'Demonstrates confidence, expressiveness, audience engagement, and effective use of the stage.'),
          pct('Overall Performance and Entertainment Value', 20, 'Demonstrates audience impact, performance quality, coherence, and overall impression.'),
        ],
      },
    ],
  },
  {
    name: 'Multimedia Film Festival',
    eventType: 'other',
    categories: [
      {
        name: 'Multimedia Film Festival',
        // Equal criteria, no weights: judge total = Σ of the 7 criteria (max 140).
        // Ranking is identical to "total ÷ 7".
        scoringMethod: 'average',
        decimalPlaces: 2,
        instructions: `Score each criterion from 1 to 20. ${FILM_RUBRIC}`,
        criteria: ['Concept', 'Script / Storyboard', 'Content / Organization', 'Quality', 'Teamwork', 'Timeliness', 'Impact'].map(
          (name) => [name, 0, 20, FILM_RUBRIC]
        ),
        minScore: 1,
        // Best Story / Screenplay = highest average in "Script / Storyboard"; Best Multimedia Film = 1st place overall.
        specialAwards: [
          { name: 'Best Story / Screenplay', basis: 'criterion', criterion: 'Script / Storyboard' },
          { name: 'Best Multimedia Film', basis: 'final' },
        ],
      },
    ],
  },
  {
    name: 'SITCON 2026',
    eventType: 'academic',
    categories: [
      {
        name: 'Best Capstone',
        scoringMethod: 'weighted',
        instructions: 'Score each criterion up to its maximum points. Total is out of 100.',
        criteria: PRESENTATION,
      },
      {
        name: 'Best Presenter – Individual Students',
        scoringMethod: 'weighted',
        instructions: 'Score each presenter on every criterion up to its maximum points. Total is out of 100.',
        criteria: PRESENTATION,
      },
    ],
  },
  {
    name: 'Mr. and Ms. SIT',
    eventType: 'pageant',
    // Criteria not provided yet: categories are created empty, to be filled in the UI.
    categories: [
      { name: 'Mr. SIT', scoringMethod: 'weighted', criteria: [] },
      { name: 'Ms. SIT', scoringMethod: 'weighted', criteria: [] },
    ],
  },
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

await connectDB();

const ownerEmail = arg('owner')?.toLowerCase().trim();
const owner = ownerEmail
  ? await User.findOne({ email: ownerEmail })
  : await User.findOne({ role: 'super_admin', status: 'active' }).sort({ createdAt: 1 });
if (!owner) {
  console.error(ownerEmail ? `No user with email ${ownerEmail}.` : 'No active Super Admin found. Run npm run create-admin first.');
  await mongoose.disconnect();
  process.exit(1);
}
const req = { user: owner, ip: '127.0.0.1 (seed:sit)' };
console.log(`[seed:sit] Owner: ${owner.name} <${owner.email}>`);

for (const def of EVENTS) {
  let event = await Event.findOne({ name: def.name });
  if (event) {
    console.log(`= Event exists: ${def.name}`);
  } else {
    event = await Event.create({ name: def.name, eventType: def.eventType, status: 'draft', organizer: 'SIT', createdBy: owner._id });
    await audit(req, { action: 'event.created', entityType: 'Event', entityId: event._id, entityLabel: event.name, event: event._id, after: { name: event.name } });
    console.log(`+ Event created: ${def.name}`);
  }

  for (const [ci, cdef] of def.categories.entries()) {
    let category = await Category.findOne({ event: event._id, name: cdef.name });
    if (!category) {
      category = await Category.create({
        event: event._id,
        name: cdef.name,
        order: ci + 1,
        scoringMethod: cdef.scoringMethod,
        decimalPlaces: cdef.decimalPlaces ?? 2,
        instructions: cdef.instructions,
        createdBy: owner._id,
      });
      await audit(req, { action: 'category.created', entityType: 'Category', entityId: category._id, entityLabel: category.name, event: event._id });
      console.log(`  + Category: ${cdef.name} (${cdef.scoringMethod})`);
    }

    await seedCriteria(event, category, cdef);
    await seedSpecialAwards(event, category, cdef);
  }
}

async function seedSpecialAwards(event, category, cdef) {
  if (!cdef.specialAwards?.length) return;
  if (category.specialAwards?.length) {
    console.log(`  = ${cdef.name}: special awards already set, left unchanged.`);
    return;
  }
  const awards = [];
  for (const a of cdef.specialAwards) {
    if (a.basis !== 'criterion') {
      awards.push({ name: a.name, basis: a.basis });
      continue;
    }
    const crit = await Criterion.findOne({ category: category._id, name: a.criterion, isActive: true });
    if (!crit) {
      console.log(`  ! ${cdef.name}: criterion "${a.criterion}" not found — "${a.name}" skipped.`);
      continue;
    }
    awards.push({ name: a.name, basis: 'criterion', criterion: crit._id });
  }
  category.specialAwards = awards;
  await category.save();
  await audit(req, { action: 'category.updated', entityType: 'Category', entityId: category._id, entityLabel: category.name, event: event._id, after: { specialAwards: awards.map((a) => a.name) } });
  console.log(`  + ${cdef.name}: special awards — ${awards.map((a) => a.name).join(', ')}`);
}

async function seedCriteria(event, category, cdef) {
    if (!cdef.criteria.length) {
      console.log(`  ! ${cdef.name}: no criteria provided yet — add them in the app.`);
      return;
    }
    if (category.configLocked) {
      console.log(`  = ${cdef.name}: scoring is locked, criteria left unchanged.`);
      return;
    }
    if (await Criterion.exists({ category: category._id })) {
      console.log(`  = ${cdef.name}: already has criteria, left unchanged.`);
      return;
    }

    await Criterion.insertMany(
      cdef.criteria.map(([name, weight, maxScore, description], i) => ({
        event: event._id,
        category: category._id,
        name,
        weight,
        minScore: cdef.minScore ?? 0,
        maxScore,
        decimalPlaces: 2,
        description,
        order: i + 1,
        createdBy: owner._id,
      }))
    );
    const total = cdef.criteria.reduce((s, c) => s + c[1], 0);
    await audit(req, { action: 'criteria.imported', entityType: 'Category', entityId: category._id, entityLabel: category.name, event: event._id, meta: { count: cdef.criteria.length } });
    console.log(`  + ${cdef.name}: ${cdef.criteria.length} criteria${total ? ` (weights ${total}%)` : ''}`);
}

await mongoose.disconnect();
console.log('[seed:sit] Done.');
