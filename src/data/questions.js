// ═══════════════════════════════════════════════════════════════════════════════
//  QUESTIONS  —  transcribed verbatim from the researchers' content document
//  ("ESCAPE ROOM GAME (CONTENT)" PDF). Do not reword without researcher approval.
//
//  Room 1  EASY     — 15 multiple-choice definition/concept items
//  Room 2  MODERATE — 10 guided problems; favorable & total outcomes given
//  Room 3  HARD     — 10 real-life word problems; identify data and compute
//
//  Each run draws QUESTIONS_PER_ROOM (5) random items per room, so a replayed
//  or timed-out level presents different problems (researchers' requirement 2).
//
//  Each question:
//    text     the question shown to the player (verbatim from the PDF)
//    choices  exactly 4 answer strings
//    correct  0-based index of the correct choice (per the PDF answer key)
//    hint     shown before the question in P-LEARN mode
//    steps    (MODERATE only) the correct fill-in values for the PDF's
//             "P(insert) = (insert)/(insert)" solution scaffold, in order —
//             substitution first, then simplification. Rendered as the
//             tap-to-fill scaffold in the question modal (main.js).
// ═══════════════════════════════════════════════════════════════════════════════

export const ROOMS = [

  // ── ROOM 1 · EASY — Multiple Choice Items (PDF bank: 15) ─────────────────────
  {
    id: 1,
    name: 'ROOM 1',
    label: 'EASY',
    codeDigit: '4',
    questions: [
      {
        text: 'A mathematical concept that deals with the possibility of the occurrence of a particular happening or event.',
        choices: ['Experiments', 'Outcomes', 'Probability', 'Simple Event'],
        correct: 2,
        hint: 'It is also referred to as the measure of chances.',
      },
      {
        text: 'It is the individual results of an experiment.',
        choices: ['Experiments', 'Outcome', 'Probability', 'Simple Event'],
        correct: 1,
        hint: 'Like 6 turning up in a single roll of a die — one individual result.',
      },
      {
        text: 'These are activities such as tossing of coins, rolling of dice, drawing a card, or doing any activity that has several possible results.',
        choices: ['Experiments', 'Outcomes', 'Probability', 'Simple Event'],
        correct: 0,
        hint: 'Any activity with several possible results — even predicting the weather.',
      },
      {
        text: 'The collection of all the possible outcomes.',
        choices: ['Event', 'Experiment', 'Sample Space', 'Simple Event'],
        correct: 2,
        hint: 'For one roll of a die this is {1, 2, 3, 4, 5, 6} — everything that could happen.',
      },
      {
        text: 'A set of outcomes of an experiment or a subset of the sample space.',
        choices: ['Event', 'Experiment', 'Sample Space', 'Simple Event'],
        correct: 0,
        hint: 'Rolling an even number {2, 4, 6} is an example of one on a single die roll.',
      },
      {
        text: 'An event that has one possible outcome.',
        choices: ['Event', 'Probability', 'Sample Space', 'Simple Event'],
        correct: 3,
        hint: 'Getting exactly a 4 on one roll of a die — a single, specific result.',
      },
      {
        text: 'An event that has produce the desired result or expected event.',
        choices: ['Event', 'Favorable outcome', 'Possible outcomes', 'Simple Event'],
        correct: 1,
        hint: 'The outcome you are hoping for — the "favorable" one.',
      },
      {
        text: 'What is the formula in finding the probability of simple events?',
        choices: [
          'P(event) = number of possible outcomes ÷ number of favorable outcomes',
          'P(event) = number of favorable outcomes ÷ number of possible outcomes',
          'P(event) = number of favorable outcomes + number of possible outcomes',
          'P(event) = number of favorable outcomes × number of possible outcomes',
        ],
        correct: 1,
        hint: 'Favorable on top, possible on the bottom.',
      },
      {
        text: 'You roll a standard six-sided die. What is the probability of rolling an even number? What is being asked in this problem?',
        choices: [
          'The number of even outcomes on a die',
          'The probability of getting an even number when rolling a die',
          'The total number of sides of a die',
          'The definition of probability',
        ],
        correct: 1,
        hint: 'Read the question again — what value does it want you to find?',
      },
      {
        // NOTE: the PDF answer key marks "1/2" for this item, but the question
        // asks for the NUMBER of favorable outcomes, which is 1 (heads).
        // Imported with the conceptually correct key — flagged for researcher
        // confirmation in docs/requirements-tracking.md.
        text: 'A coin is tossed once. What is the probability of getting heads? In this problem, what is the number of favorable outcome/s?',
        choices: ['0', '1/2', '1', '2'],
        correct: 2,
        hint: 'Count the outcomes you want: how many sides of the coin are heads?',
      },
      {
        text: 'A standard deck of 52 playing cards is shuffled. One card is drawn. What is the probability of drawing a heart? What is the number of favorable outcomes?',
        choices: ['4', '13', '26', '52'],
        correct: 1,
        hint: 'Count how many hearts are in a standard deck.',
      },
      {
        text: 'A coin is tossed once. What is the probability of getting tails? What is being asked in this problem?',
        choices: [
          'The probability of getting tails when tossing a coin.',
          'The total number of outcomes',
          'The number of coins used',
          'The definition of an event',
        ],
        correct: 0,
        hint: 'Focus on what value the problem wants you to find.',
      },
      {
        text: 'A coin is tossed once. What is the probability of getting heads?',
        choices: ['0', '1/2', '1/3', '1'],
        correct: 1,
        hint: '1 favorable outcome (heads) out of 2 possible outcomes (heads, tails).',
      },
      {
        text: 'A standard six-sided die is rolled once. What is the probability of rolling a 6?',
        choices: ['1/2', '1/3', '1/6', '6/6'],
        correct: 2,
        hint: 'Only one face shows a 6, and a die has 6 faces in total.',
      },
      {
        text: 'A letter is chosen at random from the word CAT. What is the probability of choosing the letter A?',
        choices: ['1/3', '2/3', '1/2', '3/3'],
        correct: 0,
        hint: 'CAT has 3 letters, and exactly one of them is A.',
      },
    ],
  },

  // ── ROOM 2 · MODERATE — Guided Problems (PDF bank: 10) ───────────────────────
  {
    id: 2,
    name: 'ROOM 2',
    label: 'MODERATE',
    codeDigit: '7',
    questions: [
      {
        text: 'A bag contains 3 red balls, 5 blue balls, and 2 green balls. The number of favorable outcomes for drawing a blue ball is 5, and the total number of possible outcomes is 10. Find the probability of drawing a blue ball.',
        choices: ['1/2', '3/10', '1/5', '5/12'],
        correct: 0,
        steps: ['5/10', '1/2'],
        hint: 'Substitute: P(blue ball) = 5/10, then simplify the fraction.',
      },
      {
        text: 'A die is rolled. The favorable outcomes for getting an even number are 3 (2, 4, and 6), and the total number of possible outcomes is 6. Find the probability of getting an even number.',
        choices: ['1/6', '1/2', '2/3', '3/5'],
        correct: 1,
        steps: ['3/6', '1/2'],
        hint: 'Substitute: P(even number) = 3/6, then simplify.',
      },
      {
        text: 'A card is drawn from a well-shuffled deck of 52 cards. Since the deck contains 4 kings, the number of favorable outcomes is 4, and the total number of possible outcomes is 52. Find the probability of drawing a king.',
        choices: ['1/13', '1/4', '4/13', '2/13'],
        correct: 0,
        steps: ['4/52', '1/13'],
        hint: 'Substitute: P(king) = 4/52, then simplify by dividing both by 4.',
      },
      {
        text: 'A spinner is divided into 8 equal sections. The number of favorable outcomes for landing on red is 2, and the total number of possible outcomes is 8. Find the probability of landing on red.',
        choices: ['1/2', '1/4', '1/8', '3/8'],
        correct: 1,
        steps: ['2/8', '1/4'],
        hint: 'Substitute: P(red) = 2/8, then simplify.',
      },
      {
        text: 'A class consists of 12 boys and 8 girls. The number of favorable outcomes for selecting a girl is 8, and the total number of students is 20. Find the probability of selecting a girl.',
        choices: ['3/5', '2/5', '8/12', '1/4'],
        correct: 1,
        steps: ['8/20', '2/5'],
        hint: 'Substitute: P(girl) = 8/20, then simplify by dividing both by 4.',
      },
      {
        text: 'A box contains 6 apples and 4 oranges. The number of favorable outcomes for picking an apple is 6, and the total number of possible outcomes is 10. Find the probability of picking an apple.',
        choices: ['2/5', '3/5', '6/4', '1/2'],
        correct: 1,
        steps: ['6/10', '3/5'],
        hint: 'Substitute: P(apple) = 6/10, then simplify.',
      },
      {
        text: 'A jar contains 7 black marbles and 3 white marbles. The number of favorable outcomes for selecting a white marble is 3, and the total number of marbles is 10. Find the probability of selecting a white marble.',
        choices: ['7/10', '3/7', '3/10', '1/3'],
        correct: 2,
        steps: ['3/10'],
        hint: 'Substitute: P(white marble) = 3/10. This fraction is already in lowest terms.',
      },
      {
        text: 'A number is chosen from 1 to 10. The favorable outcomes for choosing a number greater than 7 are 3 (8, 9, and 10), and the total number of possible outcomes is 10. Find the probability of choosing a number greater than 7.',
        choices: ['3/10', '7/10', '1/3', '3/7'],
        correct: 0,
        steps: ['3/10'],
        hint: 'Substitute: P(greater than 7) = 3/10. Already in lowest terms.',
      },
      {
        text: 'A coin is tossed. The number of favorable outcomes for getting head is 1, and the total number of possible outcomes is 2. Find the probability of getting heads.',
        choices: ['0', '1', '1/2', '2/1'],
        correct: 2,
        steps: ['1/2'],
        hint: 'Substitute: P(heads) = 1/2. Already in lowest terms.',
      },
      {
        text: 'A bag contains 8 yellow balls and 2 purple balls. The number of favorable outcomes for drawing a purple ball is 2, and the total number of possible outcomes is 10. Find the probability of drawing a purple ball.',
        choices: ['4/5', '1/5', '2/8', '1/2'],
        correct: 1,
        steps: ['2/10', '1/5'],
        hint: 'Substitute: P(purple ball) = 2/10, then simplify.',
      },
    ],
  },

  // ── ROOM 3 · HARD — Real-Life Word Problems (PDF bank: 10) ───────────────────
  {
    id: 3,
    name: 'ROOM 3',
    label: 'HARD',
    codeDigit: '9',
    questions: [
      {
        text: 'A board game uses a six-sided die. A player earns bonus points when an even number is rolled. What is the probability of earning bonus points?',
        choices: ['1/6', '1/3', '1/2', '2/3'],
        correct: 2,
        hint: 'Count the even numbers on a die (2, 4, 6), then divide by the total faces.',
      },
      {
        text: 'Your bag contains 4 red marbles, 3 blue marbles, and 2 green marbles. What is the probability of choosing a blue marble?',
        choices: ['1/3', '3/4', '1/9', '2/9'],
        correct: 0,
        hint: 'Find the total marbles first (4 + 3 + 2), then divide the blue count by it and simplify.',
      },
      {
        text: 'At a candy store, a jar contains 10 chocolate, 6 strawberry, and 4 mint candies. A customer randomly receives one candy as a free sample. What is the probability of picking a candy that is not chocolate?',
        choices: ['1/4', '3/10', '1/2', '2/3'],
        correct: 2,
        hint: '"Not chocolate" means strawberry OR mint (6 + 4). Total candies = 20.',
      },
      {
        text: 'You pick one card from a standard deck of 52 playing cards. What is the probability that it is an Ace?',
        choices: ['1/52', '1/13', '4/13', '1/4'],
        correct: 1,
        hint: 'A deck has 4 Aces out of 52 cards. Simplify 4/52.',
      },
      {
        text: 'A classroom has 12 boys and 18 girls. The teacher randomly chooses one student to lead the presentation. What is the probability that the chosen student is a girl?',
        choices: ['2/5', '3/5', '12/18', '1/2'],
        correct: 1,
        hint: 'Total students = 12 + 18 = 30. Divide the girls by the total and simplify.',
      },
      {
        text: 'At a school fundraising event, a prize wheel is divided into 8 equal sections numbered 1 through 8. A participant wins a prize if the wheel lands on a prime number. What is the probability of winning a prize?',
        choices: ['3/8', '5/8', '1/2', '1/4'],
        correct: 2,
        hint: 'List the primes from 1 to 8: 2, 3, 5, 7 — that is 4 favorable out of 8.',
      },
      {
        text: 'In a classroom activity, the letters of the word "PROBABILITY" are written on separate cards and placed in a box. If one card is drawn at random, what is the probability of drawing the letter "B"?',
        choices: ['1/11', '2/11', '2/9', '1/5'],
        correct: 1,
        hint: 'Count the letters in PROBABILITY (11), and how many of them are B (2).',
      },
      {
        text: 'A box contains 50 light bulbs, 4 of which are defective. If a person picks one bulb at random, what is the probability of choosing a non-defective bulb?',
        choices: ['4/50', '23/25', '2/25', '21/25'],
        correct: 1,
        hint: 'Non-defective bulbs = 50 − 4 = 46. Simplify 46/50.',
      },
      {
        text: 'A classroom has 36 students: 14 boys and 22 girls. If a student is selected at random for cleaning duty, what is the probability that the selected student is a girl?',
        choices: ['11/18', '7/18', '22/14', '1/2'],
        correct: 0,
        hint: '22 girls out of 36 students. Divide both by 2 to simplify.',
      },
      {
        text: 'A box contains 24 ballpoint pens. Half are red, and the other half are black. A student randomly selects one pen to use during an examination. What is the probability of selecting a black pen?',
        choices: ['1/24', '1/12', '1/2', '1/4'],
        correct: 2,
        hint: 'Half of 24 is 12 black pens. Simplify 12/24.',
      },
    ],
  },

];

// Number of questions drawn per room each run (researchers' requirement:
// exactly 5 problems per level, different problems on replay).
export const QUESTIONS_PER_ROOM = 5;

// Exit code = the three codeDigits joined  →  "479"
export const EXIT_CODE = ROOMS.map(r => r.codeDigit).join('');
