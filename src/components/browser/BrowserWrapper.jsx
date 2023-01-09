import React, { useContext, useEffect } from 'react';

import { SocketContext } from '../../context/socket';

import backgroundMusicSound from '../../assets/audio/backgroundMusic.mp3';

const BrowserWrapper = (props) => {
    const socket = useContext(SocketContext);

    useEffect(() => {
        socket.on('disconnect', () => {
            window.location.reload();
        });

        socket.on('board_revealed', (doubleJeoparty) => {
            if (!doubleJeoparty) {
                // const backgroundMusicAudio = new Audio(backgroundMusicSound);
                //
                // backgroundMusicAudio.loop = true;
                // backgroundMusicAudio.volume = 0.04;
                //
                // backgroundMusicAudio.play();
            }
        });

        socket.on('alert', (message) => {
            alert(message);
        });

        return () => {
            socket.off('board_revealed');
            socket.off('alert');
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div>
            {props.children}
        </div>
    );
};

export default BrowserWrapper;
