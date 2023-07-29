const _ = require('lodash');
const { MongoClient } = require('mongodb');

const api = require('../constants/api').api;

const client = new MongoClient(process.env.MONGO_DB_URL || api.MONGO_DB_URL);
const connection = client.connect();

const TOWN_OF_SALEM_NAMES = [
    'Cotton Mather',
    'Deodat Lawson',
    'Edward Bishop',
    'Giles Corey',
    'James Bayley',
    'James Russel',
    'John Hathorne',
    'John Proctor',
    'John Willard',
    'Jonathan Corwin',
    'Samuel Parris',
    'Samuel Sewall',
    'Thomas Danforth',
    'William Hobbs',
    'William Phips',
    'Abigail Hobbs',
    'Alice Young',
    'Ann Hibbins',
    'Ann Putnam',
    'Ann Sears',
    'Betty Parris',
    'Dorothy Good',
    'Lydia Dustin',
    'Martha Corey',
    'Mary Eastey',
    'Mary Johnson',
    'Mary Warren',
    'Sarah Bishop',
    'Sarah Good',
    'Sarah Wildes'
];

const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];


exports.handleLeaderboardReset = async () => {
    try {
        await connection;

        const db = client.db('leaderboard');
        const resetDataCol = db.collection('resetData');
        const resetData = await resetDataCol.findOne();

        const weekStartTime = resetData.weekStartTime || 1;
        const monthStartTime = resetData.monthStartTime || 1;

        // console.log(weekStartTime);
        // console.log(monthStartTime);

        if (weekStartTime && monthStartTime) {
            // Check for weekly reset
            let prevMonday = new Date();
            prevMonday.setDate(prevMonday.getDate() - (prevMonday.getDay() + 6) % 7);
            prevMonday.setHours(9, 0, 0, 0);

            if (prevMonday.getTime() > weekStartTime) {
                // console.log('resetting weekly leaderboard');

                await this.resetLeaderboard('week');

                await resetDataCol.findOneAndUpdate({}, {
                    '$set': {
                        'weekStartTime': prevMonday.getTime()
                    }
                });
            }

            // =======================
            // Check for monthly reset
            let now = new Date();

            let firstDayOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            firstDayOfCurrentMonth.setHours(9, 0, 0, 0);

            if (firstDayOfCurrentMonth.getTime() > monthStartTime) {
                // console.log('resetting monthly leaderboard');

                await this.resetLeaderboard('month');

                await resetDataCol.findOneAndUpdate({}, {
                    '$set': {
                        'monthStartTime': firstDayOfCurrentMonth.getTime()
                    }
                });
            }
        }
    } catch (err) {
        console.log(err.stack);
    }
}

exports.resetLeaderboard = async (colName) => {
    try {
        await connection;

        const db = client.db('leaderboard');
        await db.collection(colName).drop();

        const leaderboardCol = db.collection(colName);
        const sampleLeaderboardCol = db.collection('sample');

        const leaderboard = await sampleLeaderboardCol.find({}).toArray();
        for (const leader of leaderboard) {
            await leaderboardCol.insertOne(leader);
        }
    } catch (err) {
        console.log(err.stack);
    }
}

exports.getLeaderboards = async () => {
    try {
        await connection;

        const db = client.db('leaderboard');

        const allTimeLeaderboard = await db.collection('allTime').find({}).toArray();
        const monthLeaderboard = await db.collection('month').find({}).toArray();
        const weekLeaderboard = await db.collection('week').find({}).toArray();

        return { 'allTime': allTimeLeaderboard, 'month': monthLeaderboard, 'week': weekLeaderboard };
    } catch (err) {
        console.log(err.stack);
    }
}

const addLeader = async (player) => {
    const PLAYER_NAME = player.name.length === 0 ? choice(TOWN_OF_SALEM_NAMES) : player.name;

    try {
        await connection;

        const db = client.db('leaderboard');

        for (const colName of ['week', 'month', 'allTime']) {
            const leaderboardCol = db.collection(colName);
            const leaderboard = await leaderboardCol.find({}).toArray();

            let i = 0;

            const checkNewLeader = async () => {
                const leader = leaderboard[i];

                if (player.score > leader.score) {
                    let j = i + 1;

                    const pushLeaders = async () => {
                        await leaderboardCol.findOneAndUpdate({ 'position': j }, {
                            '$set': {
                                'name': leaderboard[j - 1].name,
                                'score': leaderboard[j - 1].score
                            }
                        }).then(async () => {
                            j++;

                            if (j <= 9) {
                                await pushLeaders();
                            } else {
                                await leaderboardCol.findOneAndUpdate({ 'position': i }, {
                                    '$set': {
                                        'name': PLAYER_NAME, 'score': player.score
                                    }
                                });
                            }
                        });
                    };

                    await pushLeaders();
                } else {
                    i++;

                    if (i < 10) {
                        await checkNewLeader();
                    }
                }
            };

            await checkNewLeader();
        }
    } catch (err) {
        console.log(err.stack);
    }
}

exports.updateLeaderboard = async (players) => {
    const playerObjects = _.values(players);

    const addNextLeader = (i) => {
        if (i < _.size(playerObjects)) {
            const player = playerObjects[i];
            addLeader(player).then(() => {
                addNextLeader(i + 1);
            });
        }
    };

    addNextLeader(0);
}