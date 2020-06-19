//#region Constants + variables

// Define needed variables.
const PORT = process.env.PORT || 3000;
const COOKIE_MAX_AGE = process.env.COOKIE_MAX_AGE || 1000 * 60 * 60 * 10;
const IS_COOKIE_SECURE = process.env.COOKIE_SECURE !== undefined || false;

// Implementing needed nodes + creating the server.
const EXPRESS_LAYOUTS = require('express-ejs-layouts');
const EXPRESS = require('express');
const SESSION = require('express-session');
const APP = EXPRESS();
const HTTP = require('http').createServer(APP);
const IO = require('socket.io')(HTTP);

// Implementing custom modules.
const SQL_QUERIES = require('./models/SqlQueries');
const SESSION_STORE = require('./models/sessionStore');

// Saving the socked ID of the admin. This will be emitted to all the users so eventually they will be able to send everything back to only the admin.
let adminSocketId = '';
let queries = new SQL_QUERIES();
let isDoublerClicked = false;

//#endregion

//#region App config

// Listening on an open port.
HTTP.listen(PORT, () => {
    console.log(`Listening on ${PORT}.`);
});

// Default folder for static content.
APP.use(EXPRESS.static("public"));

// Session configuration.
APP.use(SESSION({
    name: 'sid',
    resave: false,
    saveUninitialized: false,
    key: 'scuiz_session',
    secret: 'outrageous',
    store: SESSION_STORE,
    cookie: {
        maxAge: COOKIE_MAX_AGE,
        sameSite: true,
        secure: IS_COOKIE_SECURE
    }
}));

// Definition and config of express layouts.
APP.use(EXPRESS_LAYOUTS);
APP.set('view engine', 'ejs');

// Express body parser.
APP.use(EXPRESS.urlencoded({ extended: true }));

//#endregion

//#region Routes definition.

//#region Player

APP.get('/', require('./controllers/players'));
APP.get('/setLanguageEn', require('./controllers/players'));
APP.get('/setLanguageHu', require('./controllers/players'));
APP.get('/register', require('./controllers/players'));
APP.get('/login', require('./controllers/players'));
APP.get('/logout', require('./controllers/players'));
APP.get('/gameBoard', require('./controllers/players'));

APP.post('/register', require('./controllers/players'));
APP.post('/login', require('./controllers/players'));

//#endregion

//#region Admin

APP.get('/admin', require('./controllers/admin'));
APP.get('/controlPanel', require('./controllers/admin'));

APP.post('/adminLogin', require('./controllers/admin'));

//#endregion

//#endregion

//#region Socket event listeners.

IO.on('connection', socket => {
    console.log(`A user with ID: ${socket.id} connected.`);

    socket.on('disconnect', () => {
        console.log(`A user with ID: ${socket.id} disconnected.`);
        let playerLeft = queries.putPlayerStatusAndSocketIdBySocketIdAsync(socket.id, 0);

        playerLeft.then(() => {
            IO.to(adminSocketId).emit('playerLeft', { playerSocketId: socket.id });
        }).catch((error) => {
            console.log('playerLeft: ' + error);
        });
    });

    socket.on('postAdminSocketId', () => {
        adminSocketId = socket.id;
    });

    socket.on('signUpForGame', (data) => {
        let setSocketIdResult = queries.putPlayerSocketIdByIdAsync(data.playerId, socket.id);

        setSocketIdResult.then(() => {
            let playerResult = queries.getPlayerByIdAsync(data.playerId);

            playerResult.then((player) => {
                IO.to(adminSocketId).emit('showPlayer', { player: player[0] });
            }).catch((error) => {
                console.log('playerResult:' + error);
            });
        }).catch((error) => {
            console.log('setSocketIdResult:' + error);
        });
    });

    socket.on('pickQuestion', (data) => {
        isDoublerClicked = false;
        let putCategoryResult = queries.putCategoryQuestionIndexByIdAsync(data.categoryId, data.index);
        putCategoryResult.then(() => {
            let getQuestionResult = queries.getNextTwoQuestionsByCategoryIdAndQuestionIndexAsync(data.categoryId, data.index);

            getQuestionResult.then((question) => {
                socket.broadcast.emit('getNextQuestion', { question: question[0].question , category: { id: question[0].id, name: question[0].name }, timer: data.timer });
                IO.to(adminSocketId).emit('getQuestion', { question: question[0], nextQuestion: question[1] });
            }).catch((error) => {
                console.log('getQuestionResult: ' + error);
            })
        }).catch((error) => {
            console.log('putCategoryResult: ' + error);
        });
    });

    socket.on('raiseCategoryLimit', (data) => {
        queries.putCategoryLimit(data.index);
    });

    socket.on('collectAnswers', () => {
        socket.broadcast.emit('forcePostAnswer');
    });

    socket.on('postAnswer', (data) => {
        IO.to(adminSocketId).emit('getAnswer', {
            player: {
                id: data.player.id,
                socketId: socket.id,
                name: data.player.name,
                timeLeft: data.player.timeLeft,
                answer: data.player.answer,
                isDoubled: data.player.isDoubled
            }
        });
    });

    socket.on('finishQuestion', (data) => {
        data.correct.forEach((user) => {
            queries.putPlayerPointAddValueById(user.id, user.changeValue);
            IO.to(user.socketId).emit('updatePoint', { point: user.point + user.changeValue });
        });
        data.incorrect.forEach((user) => {
            queries.putPlayerPointSubtractValueById(user.id, user.changeValue);
            IO.to(user.socketId).emit('updatePoint', { point: user.point - user.changeValue });
        });
    });

    socket.on('logoutEveryone', () => {
        let getAllLoggedInPlayerResult = queries.getAllLoggedInPlayersAsync();

        getAllLoggedInPlayerResult.then((players) => {
            players.forEach((player) => {
                queries.putPlayerStatusById(player.id, 0);
            });
        }).catch((error) => {
            console.log('getAllLoggedInPlayerResult: ' + error);
        });
    });

    socket.on('takeChances', () => {
        if (!isDoublerClicked) {
            IO.to(socket.id).emit('doublerClicked', { isClicked: true });
            socket.broadcast.emit('doublerDisabled');
            isDoublerClicked = true;
        } else {
            IO.to(socket.id).emit('doublerClicked', { isClicked: false });
        }
    });

    socket.on('authorizePlayer', (data) => {
        IO.to(data.playerSocketId).emit('authorizeCategoryPick');
    });

    socket.on('chooseCategory', (data) => {
        IO.to(adminSocketId).emit('chosenCategory', { categoryId: data.categoryId });
    });
});

//#endregion