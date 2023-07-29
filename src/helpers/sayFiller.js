import _ from 'lodash';
import say from './say';

const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const getQuotedWords = (text) => {
    let quotedWords = [];
    let currentWord = '';
    let insideQuote = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];

        if (c === `"`) {
            if (insideQuote) {
                quotedWords.push(currentWord);
                currentWord = '';
                insideQuote = false;
            } else {
                insideQuote = true;
            }
        } else if (insideQuote) {
            currentWord += c;
        }
    }

    return quotedWords;
};

export const sayCategoryRevealIntroductionFiller = (doubleJeoparty, onComplete) => {
    const doubleJeopartyOptions = [
        `Here are the categories for double Je-party...`
    ];

    const jeopartyOptions = [
        `Here are the categories...`
    ];

    const text = doubleJeoparty ? choice(doubleJeopartyOptions) : choice(jeopartyOptions);
    say(text, onComplete);
};

export const sayCategoryRevealFiller = (categoryName, year, onComplete) => {
    const quotedWords = getQuotedWords(categoryName);
    const options = [
        ` with ${quotedWords.join(' and ')} in quotations`
    ];
    const quotedWordsText = !_.isEmpty(quotedWords) ? choice(options) : '';
    const yearText = ` from ${year}`;

    const text = categoryName + quotedWordsText + yearText;
    say(text, onComplete);
};

export const sayRoundFiller = (boardControllerName, doubleJeoparty, onComplete) => {
    const doubleJeopartyOptions = [
        `Let's get the double Je-party round started!`,
        `Let's kick off the double Je-party round!`,
        `Get ready for the double Je-party round!`
    ];

    const jeopartyOptions = [
        `We'll begin with the Je-party round!`,
        `We'll get started with the Je-party round!`,
        `Let's kick it off with the Je-party round!`
    ];

    const text = doubleJeoparty ? choice(doubleJeopartyOptions) : choice(jeopartyOptions);
    say(text, () => {
        sayBoardControllerNameFiller(boardControllerName, onComplete);
    });
};

export const sayBoardControllerNameFiller = (boardControllerName, onComplete) => {
    const options = [
        `Select a clue, ${boardControllerName}`,
        `It's your choice, ${boardControllerName}`,
        `You control the board, ${boardControllerName}`
    ];

    const text = choice(options);
    say(text, onComplete);
};

export const sayClueRequestFiller = (categoryName, dollarValue, onComplete) => {
    const text = `${categoryName} for ${dollarValue}`;
    say(text, onComplete);
};

export const sayDailyDoubleFiller = () => {
    const options = [
        `That's the daily double!`,
        `You got the daily double!`,
        `There's the daily double!`
    ];

    const text = choice(options);
    say(text);
};

export const sayWagerFiller = (min, max, onComplete) => {
    const options = [
        `Enter a wager between ${min} and ${max} dollars`
    ];

    const text = choice(options);
    say(text, onComplete);
};

export const sayDollarValueFiller = (dollarValue, onComplete) => {
    const options = [
        `Correct for ${dollarValue}`
    ];

    const text = choice(options);
    say(text, onComplete);
};

export const sayCorrectAnswerFiller = (correctAnswer, onComplete) => {
    const options = [
        `The correct answer was ${correctAnswer}`,
        `It was ${correctAnswer}`,
        `How about ${correctAnswer}?`
    ];

    const text = choice(options);
    say(text, onComplete);
};

export const sayBestStreakFiller = (playerName, streak, title, onComplete) => {
    const options = [
        `${playerName} is on a ${streak} answer streak. They're a ${title}`,
        `${playerName} has gotten ${streak} in a row. They're a ${title}`,
        `That's ${streak} in a row for ${playerName}. They're a ${title}`
    ];

    const text = choice(options);
    say(text, onComplete);
};

export const sayFinalJeopartyCategoryRevealIntroductionFiller = (onComplete) => {
    const options = [
        `The final Je-party category is...`,
        `Here's the final Je-party category...`,
        `Get ready for final Je-party. The category is...`
    ];

    const text = choice(options);
    say(text, onComplete);
};

export const sayFinalJeopartyWagerFiller = (onComplete) => {
    const options = [
        `Enter a wager between 0 and your current net worth`
    ];

    const text = choice(options);
    say(text, onComplete);
};

export const sayChampionIntroductionFiller = (onComplete) => {
    const options = [
        `And today's Je-party champion is...`,
        `Your Je-party champion is...`,
        `Let's see who today's Je-party champion is... congratulations...`,
        `Let's see who today's Je-party champion is... put your hands together for...`
    ];

    const text = choice(options);
    say(text, onComplete);
};