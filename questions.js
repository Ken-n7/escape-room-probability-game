// ═══════════════════════════════════════════════════════════════════════════════
//  QUESTIONS  —  3 difficulty levels matching the curriculum spec.
//
//  Room 1  EASY     — definitions and key concepts (no calculation needed)
//  Room 2  MODERATE — favorable & total outcomes already given; apply the formula
//  Room 3  HARD     — real-life word problems; identify data and compute
//
//  Each question:
//    text     the question shown to the player
//    choices  exactly 4 answer strings
//    correct  0-based index of the correct choice
//    hint     shown before the question in P-LEARN mode
// ═══════════════════════════════════════════════════════════════════════════════

export const ROOMS = [

  // ── ROOM 1 · EASY — Basic Concepts & Definitions ─────────────────────────────
  {
    id: 1,
    name: 'ROOM 1',
    label: 'EASY',
    codeDigit: '4',
    questions: [
      {
        text: 'What do you call the measure of how likely an event is to occur, expressed as a number between 0 and 1?',
        choices: ['Experiment', 'Sample Space', 'Probability', 'Outcome'],
        correct: 2,
        hint: 'This is the main topic of this subject. It tells us the CHANCE or LIKELIHOOD of something happening.',
      },
      {
        text: 'What do we call the set of ALL possible outcomes of an experiment?',
        choices: ['Favorable Outcome', 'Event', 'Probability', 'Sample Space'],
        correct: 3,
        hint: 'When you roll a die, this would be {1, 2, 3, 4, 5, 6} — every result that could happen.',
      },
      {
        text: 'An event that consists of exactly ONE outcome from the sample space is called a ___.',
        choices: ['Compound Event', 'Certain Event', 'Simple Event', 'Impossible Event'],
        correct: 2,
        hint: 'Getting exactly a 4 when rolling a single die is one specific, single result.',
      },
    ],
  },

  // ── ROOM 2 · MODERATE — Applying the Probability Formula ─────────────────────
  {
    id: 2,
    name: 'ROOM 2',
    label: 'MODERATE',
    codeDigit: '7',
    questions: [
      {
        text: 'A jar has 4 red marbles and 6 blue marbles. What is the probability of randomly picking a RED marble?\n[Favorable = 4, Total = 10]',
        choices: ['6/10', '4/10', '4/6', '6/4'],
        correct: 1,
        hint: 'P(Event) = Favorable Outcomes ÷ Total Outcomes.  Red marbles = 4,  Total marbles = 10.',
      },
      {
        text: 'A fair coin is tossed once. What is the probability of getting HEADS?\n[Favorable = 1, Total = 2]',
        choices: ['1/4', '2/1', '2/3', '1/2'],
        correct: 3,
        hint: 'There are only 2 equally likely outcomes: Heads or Tails. Only 1 of them is Heads.',
      },
      {
        text: 'A spinner has 8 equal sections: 3 yellow, 2 green, and 3 blue. What is the probability of landing on GREEN?\n[Favorable = 2, Total = 8]',
        choices: ['3/8', '5/8', '2/8', '6/8'],
        correct: 2,
        hint: 'Favorable outcomes = green sections = 2.  Total sections = 8.  Apply the formula.',
      },
    ],
  },

  // ── ROOM 3 · HARD — Real-Life Word Problems ────────────────────────────────────
  {
    id: 3,
    name: 'ROOM 3',
    label: 'HARD',
    codeDigit: '9',
    questions: [
      {
        text: 'In a class of 40 students, 15 are boys. If one student is chosen at random, what is the probability of selecting a GIRL?',
        choices: ['15/40', '25/40', '40/15', '15/25'],
        correct: 1,
        hint: 'Step 1: Find the number of girls → Total − Boys = Girls.  Step 2: P(girl) = Girls ÷ Total.',
      },
      {
        text: 'A box contains 5 red, 3 blue, and 2 green marbles. A marble is drawn at random. What is the probability of NOT picking a RED marble?',
        choices: ['5/10', '3/10', '2/10', '7/10'],
        correct: 0,
        hint: '"Not red" means blue OR green. Count all non-red marbles (3 + 2 = 5), then divide by total (10).',
      },
      {
        text: 'A number is chosen at random from 1 to 20. What is the probability of choosing a PRIME number?\n(Primes from 1–20: 2, 3, 5, 7, 11, 13, 17, 19)',
        choices: ['8/20', '6/20', '10/20', '4/20'],
        correct: 0,
        hint: 'List all prime numbers between 1 and 20 — those are your favorable outcomes. Total = 20.',
      },
    ],
  },

];

// Exit code = the three codeDigits joined  →  "479"
export const EXIT_CODE = ROOMS.map(r => r.codeDigit).join('');
