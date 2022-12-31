const _ = require('lodash');
const { MongoClient } = require('mongodb');

const api = require('../constants/api').api;

// const samplePlayers = require('../constants/samplePlayers').samplePlayers;

const client = new MongoClient(api.MONGO_DB_URL);
const connection = client.connect();

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

exports.getLeaderboard = async () => {
    try {
        await connection;

        const db = client.db('leaderboard');
        const leaderboardCol = db.collection('allTime');

        return await leaderboardCol.find({}).toArray();
    } catch (err) {
        console.log(err.stack);
    }
}

const addLeader = async (player) => {
    try {
        await connection;

        const db = client.db('leaderboard');

        for (const colName of ['allTime']) {
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
                                        'name': player.name, 'score': player.score
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