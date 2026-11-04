/** Quotations and translations transcribed from Gothic_War_Quotes_Latin_and_English.pdf. */
type OutcomeQuote = { text: string; translation?: string; author: string; work: string };

const victoryQuotes: OutcomeQuote[] = [
  {
    text: 'Uneasy lies the head that wears a crown.',
    author: 'William Shakespeare',
    work: 'Henry IV, Part 2 · III.i',
  },
  {
    text: 'Exegi monumentum aere perennius.',
    translation: 'I have built a monument more lasting than bronze.',
    author: 'Horace',
    work: 'Odes · III.30',
  },
  {
    text: 'My name is Ozymandias, king of kings: Look on my works, ye Mighty, and despair!',
    author: 'Percy Bysshe Shelley',
    work: 'Ozymandias · 1818',
  },
  {
    text: 'Ubi solitudinem faciunt, pacem appellant.',
    translation: 'Where they make a wasteland, they call it peace.',
    author: 'Tacitus',
    work: 'Agricola · 30',
  },
];

const defeatQuotes: OutcomeQuote[] = [
  {
    text: 'Pulvis et umbra sumus.',
    translation: 'We are dust and shadow.',
    author: 'Horace',
    work: 'Odes · IV.7',
  },
  {
    text: 'What’s done cannot be undone.',
    author: 'William Shakespeare',
    work: 'Macbeth · V.i',
  },
  {
    text: 'The world was void.',
    author: 'Lord Byron',
    work: 'Darkness · 1816',
  },
  {
    text: 'Venit summa dies et ineluctabile tempus.',
    translation: 'The final day has come, and the inescapable hour.',
    author: 'Virgil',
    work: 'Aeneid · II.324',
  },
];

/** Keep a campaign's quote stable on reload without consuming gameplay RNG. */
export function getOutcomeQuote(campaignId: string, won: boolean): OutcomeQuote {
  const quotes = won ? victoryQuotes : defeatQuotes;
  let hash = 0;
  for (const letter of campaignId) hash = (Math.imul(hash, 31) + letter.charCodeAt(0)) >>> 0;
  return quotes[hash % quotes.length];
}
