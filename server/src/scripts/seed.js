/**
 * Development seed. Wipes the configured database and loads realistic demo data:
 *   - one account per role (see README for credentials)
 *   - a published pageant (Mr. & Ms. University) with an engineered, tie-broken result
 *   - a dance competition mid-scoring (incomplete sheets, trimmed-mean category, overall tally)
 *   - a singing competition still in setup (weighted + rank-based categories)
 *
 *   npm run seed            (refuses to run when NODE_ENV=production)
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import Event from '../models/Event.js';
import Category from '../models/Category.js';
import Contestant from '../models/Contestant.js';
import Criterion from '../models/Criterion.js';
import EventAssignment from '../models/EventAssignment.js';
import ScoreSheet from '../models/ScoreSheet.js';
import Setting from '../models/Setting.js';
import { lockConfiguration, generateResult, transitionResult } from '../services/tabulationService.js';
import { round } from '../services/scoringEngine.js';
import { audit } from '../services/auditService.js';

if (env.isProd) {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}

export const DEMO_PASSWORD = 'Tally@2026';

// Deterministic pseudo-random numbers so the demo is reproducible
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261118);

async function user(name, email, role, extra = {}) {
  const u = new User({ name, email, role, ...extra });
  await u.setPassword(DEMO_PASSWORD);
  return u.save();
}

const reqAs = (u) => ({ user: u, ip: '127.0.0.1 (seed)' });

async function criteria(category, list, by) {
  return Criterion.insertMany(
    list.map(([name, weight, maxScore, description], i) => ({
      event: category.event,
      category: category._id,
      name,
      weight,
      minScore: 0,
      maxScore,
      decimalPlaces: 2,
      description,
      order: i + 1,
      createdBy: by._id,
    }))
  );
}

/** Writes submitted sheets as a judge would, with values near a contestant "strength". */
async function scoreCategory(category, judges, contestants, crits, strength, { skip = [], drafts = [], overrides = {} } = {}) {
  for (const j of judges) {
    for (const c of contestants) {
      const key = `${j.email}|${c.number}`;
      if (skip.includes(key)) continue;
      const scores = crits.map((cr) => {
        const forced = overrides[key]?.[cr.name];
        if (forced !== undefined) return { criterion: cr._id, value: forced };
        const base = (strength[c.number] ?? 0.8) * cr.maxScore;
        const noise = (rand() - 0.5) * 0.12 * cr.maxScore;
        return { criterion: cr._id, value: round(Math.min(cr.maxScore, Math.max(cr.minScore, base + noise)), 2) };
      });
      const computedTotal = round(scores.reduce((a, s) => a + s.value, 0), 4);
      const computedWeighted = round(scores.reduce((a, s, i) => a + (s.value / crits[i].maxScore) * crits[i].weight, 0), 4);
      const isDraft = drafts.includes(key);
      const at = new Date(Date.now() - Math.floor(rand() * 5) * 86400000 - Math.floor(rand() * 3600000));
      await ScoreSheet.create({
        event: category.event,
        category: category._id,
        judge: j._id,
        contestant: c._id,
        configVersion: category.configVersion,
        scores,
        computedTotal,
        computedWeighted,
        status: isDraft ? 'draft' : 'submitted',
        savedAt: at,
        submittedAt: isDraft ? undefined : at,
        submissionCount: isDraft ? 0 : 1,
        history: isDraft ? [] : [{ action: 'submitted', by: j._id, at, scores }],
      });
    }
  }
}

async function run() {
  await connectDB();
  console.log('[seed] Clearing database…');
  await mongoose.connection.db.dropDatabase();
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).syncIndexes()));

  await Setting.create({ key: 'global', systemName: 'Overall Tally', organizationName: 'Demo State University — Office of Student Affairs' });

  // ------------------------------------------------------------ accounts
  const superAdmin = await user('System Administrator', 'superadmin@tally.test', 'super_admin');
  const admin = await user('Andrea Villanueva', 'admin@tally.test', 'event_admin', { title: 'Event Coordinator', affiliation: 'Office of Student Affairs' });
  const admin2 = await user('Paolo Mendoza', 'admin2@tally.test', 'event_admin', { title: 'Sports Coordinator' });
  const tab = await user('Liza Ramos', 'tabulator@tally.test', 'tabulator', { title: 'Head Tabulator' });
  const tab2 = await user('Mark Dizon', 'tabulator2@tally.test', 'tabulator');
  const judges = [
    await user('Dr. Elena Cruz', 'judge1@tally.test', 'judge', { title: 'Chair, Panel of Judges', affiliation: 'College of Arts' }),
    await user('Ramon Bautista', 'judge2@tally.test', 'judge', { title: 'Professional Choreographer' }),
    await user('Carla Reyes', 'judge3@tally.test', 'judge', { title: 'Former Beauty Titleholder' }),
    await user('Jose Santos', 'judge4@tally.test', 'judge', { title: 'Dance Instructor' }),
    await user('Mika Tan', 'judge5@tally.test', 'judge', { title: 'Vocal Coach' }),
  ];
  for (const u of [superAdmin, admin, tab]) await audit(reqAs(u), { action: 'auth.login', entityType: 'User', entityId: u._id, entityLabel: u.email });

  const assign = (event, u, role, categories = [], order = 0) => EventAssignment.create({ event: event._id, user: u._id, role, categories, order, assignedBy: superAdmin._id });

  // ------------------------------------------------------------ EVENT 1: pageant (published)
  const pageant = await Event.create({
    name: 'Mr. & Ms. University 2026',
    description: 'The annual search for the ambassadors of the university, celebrating intelligence, talent and advocacy.',
    eventType: 'pageant',
    venue: 'University Gymnasium',
    organizer: 'Supreme Student Council',
    eventDate: new Date('2026-11-14T18:00:00+08:00'),
    startDate: new Date('2026-11-14T18:00:00+08:00'),
    endDate: new Date('2026-11-14T22:00:00+08:00'),
    status: 'active',
    createdBy: superAdmin._id,
  });
  await assign(pageant, admin, 'event_admin');
  await assign(pageant, tab, 'tabulator');

  const mr = await Category.create({ event: pageant._id, name: 'Mr. University', order: 1, scoringMethod: 'weighted', decimalPlaces: 2, instructions: 'Score each criterion from 1 to 10. Up to two decimal places are allowed.', createdBy: admin._id });
  const ms = await Category.create({ event: pageant._id, name: 'Ms. University', order: 2, scoringMethod: 'weighted', decimalPlaces: 2, instructions: 'Score each criterion from 1 to 10. Up to two decimal places are allowed.', createdBy: admin._id });
  const talent = await Category.create({ event: pageant._id, name: 'Best in Talent', order: 3, scoringMethod: 'weighted', decimalPlaces: 2, createdBy: admin._id });

  const colleges = ['College of Engineering', 'College of Nursing', 'College of Education', 'College of Business', 'College of Arts and Sciences', 'College of Computing'];
  const mrNames = ['Gabriel Santos', 'Joshua Dela Cruz', 'Miguel Navarro', 'Rafael Aquino', 'Daniel Garcia', 'Adrian Lim'];
  const msNames = ['Sofia Mercado', 'Isabella Reyes', 'Camille Torres', 'Angela Fernandez', 'Bianca Ocampo', 'Patricia Uy'];
  const mrC = await Contestant.insertMany(mrNames.map((name, i) => ({ event: pageant._id, number: i + 1, name, representing: colleges[i], description: 'Advocacy: youth leadership and mental health awareness.', createdBy: admin._id })));
  const msC = await Contestant.insertMany(msNames.map((name, i) => ({ event: pageant._id, number: i + 7, name, representing: colleges[i], description: 'Advocacy: environmental stewardship.', createdBy: admin._id })));
  mr.contestants = mrC.map((c) => c._id);
  ms.contestants = msC.map((c) => c._id);
  talent.contestants = [...mrC, ...msC].map((c) => c._id);
  await Promise.all([mr.save(), ms.save(), talent.save()]);

  const pageantCriteria = [
    ['Creativity', 30, 10, 'Originality and creativity of the production and presentation.'],
    ['Performance', 40, 10, 'Poise, confidence, delivery and execution on stage.'],
    ['Overall Impact', 30, 10, 'Audience impact and overall impression.'],
  ];
  const mrCrit = await criteria(mr, pageantCriteria, admin);
  const msCrit = await criteria(ms, pageantCriteria, admin);
  const talentCrit = await criteria(talent, [['Mastery of Talent', 50, 10], ['Stage Presence', 30, 10], ['Audience Impact', 20, 10]], admin);

  const panel = judges.slice(0, 3);
  for (const [i, j] of panel.entries()) await assign(pageant, j, 'judge', [mr._id, ms._id, talent._id], i + 1);

  for (const c of [mr, ms, talent]) await lockConfiguration(reqAs(admin), c);
  const [mrL, msL, talentL] = await Promise.all([Category.findById(mr._id), Category.findById(ms._id), Category.findById(talent._id)]);

  await scoreCategory(mrL, panel, mrC, mrCrit, { 1: 0.86, 2: 0.79, 3: 0.91, 4: 0.75, 5: 0.83, 6: 0.88 });
  // Ms. University: #8 and #10 are engineered to tie on the final score; #10 wins on Performance (the 40% criterion)
  const tieA = { Creativity: 9.5, Performance: 8.5, 'Overall Impact': 9 }; // weighted 89.5
  const tieB = { Creativity: 8.75, Performance: 9.25, 'Overall Impact': 8.75 }; // weighted 89.5
  const overrides = {};
  for (const j of panel) {
    overrides[`${j.email}|8`] = tieA;
    overrides[`${j.email}|10`] = tieB;
  }
  await scoreCategory(msL, panel, msC, msCrit, { 7: 0.84, 9: 0.92, 11: 0.8, 12: 0.77 }, { overrides });
  await scoreCategory(talentL, panel, [...mrC, ...msC], talentCrit, Object.fromEntries([...mrC, ...msC].map((c) => [c.number, 0.72 + rand() * 0.22])));

  for (const c of [mrL, msL]) {
    const r = await generateResult(reqAs(tab), { event: pageant, category: c });
    await transitionResult(reqAs(tab), r, 'submit', 'All score sheets verified against the judges’ printed sheets.');
    await transitionResult(reqAs(admin), r, 'approve');
    await transitionResult(reqAs(admin), r, 'publish');
  }
  await generateResult(reqAs(tab), { event: pageant, category: talentL });

  // ------------------------------------------------------------ EVENT 2: dance (scoring in progress)
  const dance = await Event.create({
    name: 'Inter-College Dance Showdown 2026',
    description: 'Dance groups from every college compete in hip-hop and contemporary divisions for the overall championship.',
    eventType: 'dance',
    venue: 'University Amphitheater',
    organizer: 'Cultural Affairs Office',
    eventDate: new Date('2026-11-20T15:00:00+08:00'),
    status: 'upcoming',
    overall: { enabled: true, title: 'Overall Dance Champion', method: 'weighted', decimalPlaces: 2 },
    createdBy: admin._id,
  });
  await assign(dance, admin, 'event_admin');
  await assign(dance, tab, 'tabulator');
  const hiphop = await Category.create({ event: dance._id, name: 'Hip-Hop Division', order: 1, scoringMethod: 'weighted', includeInOverall: true, overallWeight: 50, createdBy: admin._id });
  const contemporary = await Category.create({
    event: dance._id,
    name: 'Contemporary Division',
    order: 2,
    scoringMethod: 'custom',
    customStrategy: 'trimmed_mean',
    includeInOverall: true,
    overallWeight: 50,
    instructions: 'The highest and lowest judge scores are dropped for each team.',
    createdBy: admin._id,
  });
  const teams = ['Engineering Steppers', 'Nursing Movers', 'Education Elite', 'Business Crew', 'Arts Collective'];
  const teamC = await Contestant.insertMany(
    teams.map((name, i) => ({ event: dance._id, number: i + 1, name, isTeam: true, teamName: name, representing: colleges[i], members: ['Member A', 'Member B', 'Member C', 'Member D', 'Member E', 'Member F'].map((m) => `${m} (${name.split(' ')[0]})`), createdBy: admin._id }))
  );
  hiphop.contestants = teamC.map((c) => c._id);
  contemporary.contestants = teamC.map((c) => c._id);
  await Promise.all([hiphop.save(), contemporary.save()]);
  const danceCriteria = [
    ['Choreography', 30, 100, 'Complexity, musicality and use of formations.'],
    ['Synchronization', 25, 100, 'Unity and timing of the group.'],
    ['Creativity', 25, 100, 'Originality of concept, costume and music.'],
    ['Stage Presence', 20, 100, 'Energy, expression and audience connection.'],
  ];
  const hhCrit = await criteria(hiphop, danceCriteria, admin);
  const ctCrit = await criteria(contemporary, danceCriteria, admin);
  const dancePanel = [judges[0], judges[1], judges[3], judges[4]];
  for (const [i, j] of dancePanel.entries()) await assign(dance, j, 'judge', [hiphop._id, contemporary._id], i + 1);
  await lockConfiguration(reqAs(admin), hiphop);
  await lockConfiguration(reqAs(admin), contemporary);
  const [hhL, ctL] = await Promise.all([Category.findById(hiphop._id), Category.findById(contemporary._id)]);
  const danceStrength = { 1: 0.88, 2: 0.81, 3: 0.85, 4: 0.79, 5: 0.9 };
  await scoreCategory(hhL, dancePanel, teamC, hhCrit, danceStrength, { drafts: ['judge5@tally.test|4', 'judge5@tally.test|5'] });
  await scoreCategory(ctL, dancePanel, teamC, ctCrit, danceStrength, { skip: dancePanel.slice(2).flatMap((j) => teamC.slice(3).map((c) => `${j.email}|${c.number}`)) });

  // ------------------------------------------------------------ EVENT 3: singing (setup)
  const singing = await Event.create({
    name: 'Battle of the Voices 2026',
    description: 'Solo and duet singing competition open to all students.',
    eventType: 'singing',
    venue: 'Little Theater',
    organizer: 'University Chorale',
    eventDate: new Date('2026-12-05T17:00:00+08:00'),
    status: 'draft',
    createdBy: admin._id,
  });
  await assign(singing, admin, 'event_admin');
  await assign(singing, tab2, 'tabulator');
  const solo = await Category.create({ event: singing._id, name: 'Solo Vocals', order: 1, scoringMethod: 'weighted', createdBy: admin._id });
  const duet = await Category.create({ event: singing._id, name: 'Duet Showcase', order: 2, scoringMethod: 'rank', tieBreakRules: [{ type: 'shared' }], instructions: 'Rank the duets from 1 (best) to last. Each rank can be used once.', createdBy: admin._id });
  const singers = await Contestant.insertMany(['Kyla Manalo', 'Jericho Valdez', 'Trisha Gomez', 'Nathan Sy'].map((name, i) => ({ event: singing._id, number: i + 1, name, representing: colleges[i], createdBy: admin._id })));
  const duets = await Contestant.insertMany(['Harmony Duo', 'Echo & Lyric', 'Two Tones'].map((name, i) => ({ event: singing._id, number: i + 11, name, isTeam: true, teamName: name, members: ['Singer 1', 'Singer 2'], createdBy: admin._id })));
  solo.contestants = singers.map((c) => c._id);
  duet.contestants = duets.map((c) => c._id);
  await Promise.all([solo.save(), duet.save()]);
  await criteria(solo, [['Vocal Quality', 40, 100], ['Diction', 20, 100], ['Interpretation', 20, 100], ['Stage Presence', 20, 100]], admin);
  for (const [i, j] of [judges[0], judges[4], judges[2]].entries()) await assign(singing, j, 'judge', [solo._id, duet._id], i + 1);

  // admin2 owns an empty sports event to show event-level isolation
  const sports = await Event.create({ name: 'Intramurals 2026 — Cheerdance', eventType: 'sports', venue: 'Main Oval', status: 'draft', createdBy: admin2._id, eventDate: new Date('2027-01-15T08:00:00+08:00') });
  await assign(sports, admin2, 'event_admin');

  console.log('\n[seed] Done. Demo accounts (password for all: %s):', DEMO_PASSWORD);
  console.table([
    { role: 'Super Admin', email: 'superadmin@tally.test' },
    { role: 'Event Admin', email: 'admin@tally.test' },
    { role: 'Event Admin (other events)', email: 'admin2@tally.test' },
    { role: 'Tabulator', email: 'tabulator@tally.test' },
    { role: 'Tabulator', email: 'tabulator2@tally.test' },
    { role: 'Judge', email: 'judge1@tally.test … judge5@tally.test' },
  ]);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('[seed] Failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
