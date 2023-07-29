import React, { useState, useContext, useEffect } from 'react';
import _ from 'lodash';

import styled from 'styled-components';
import Container from 'react-bootstrap/Container';
import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import FitText from '@kennethormandy/react-fittext';

import { DebugContext } from '../../context/debug';
import { SocketContext } from '../../context/socket';
import mixins from '../../helpers/mixins';
import Timer from '../../helpers/components/Timer';
import CategoryReveal from '../../helpers/components/CategoryReveal';
import { timers } from '../../constants/timers';

import finalJeopartyPingSound from '../../assets/audio/finalJeopartyPing.mp3';
import {
    sayWagerFiller,
    sayFinalJeopartyCategoryRevealIntroductionFiller,
    sayFinalJeopartyWagerFiller,
    sayCategoryRevealFiller
} from '../../helpers/sayFiller';

// DEBUG
import { sampleCategories } from '../../constants/sampleCategories';
import { samplePlayers } from '../../constants/samplePlayers';

const FinalJeopartyCategoryRevealWrapper = styled.div`
    position: absolute;
    ${mixins.flexAlignCenter};
    height: 100vh;
    width: 100vw;

    opacity: ${props => props.showFinalJeopartyCategoryReveal ? 1 : 0};
    transition: opacity 1s;
`;

const DailyDoubleBanner = styled.div`
    ${mixins.flexAlignCenter};
    height: 10vh;
  
    padding-bottom: 0.5em;
`;

const FinalJeopartyBanner = styled.div`
    ${mixins.flexAlignCenter};
    height: 10vh;
`;

const FinalJeopartyLogoText = styled.span`
    font-family: logo, serif;
    font-size: 8vh;
    text-shadow: 0.05em 0.05em #000;
    line-height: 1;
`;

const FinalJeopartyWagerContainer = styled(Container)`
    ${mixins.flexAlignCenter};
    height: 70vh;
    width: 100vw;
`;

const FinalJeopartyWagerInfoText = styled.span`
    font-size: 4vh;
    font-weight: bold;
    font-family: clue, serif;
    text-shadow: 0.1em 0.1em #000;
`;

const FinalJeopartyWagerPanel = styled.div`
    height: 20%;
    border: 0.3em solid black;
    box-shadow: 0.5em 0.5em black;

    ${mixins.flexAlignCenter};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
`;

const WagerInfoContainer = styled(Container)`
    height: 70vh;
    width: 100vw;
`;

const WagerInfoWrapper = styled(Col)`
    height: 70vh;
    padding: 5vh;
`;

const WagerInfoRow = styled(Row)`
    height: 33%;
`;

const WagerInfoCol = styled(Col)`
    ${mixins.flexAlignCenter};
`;

const WagerInfoHeaderText = styled.span`
    font-size: 4vh;
    font-family: clue, serif;
    text-shadow: 0.1em 0.1em #000;
`;

const WagerInfoPanel = styled.div`
    height: 50%;
    border: 0.3em solid black;
    box-shadow: 0.5em 0.5em black;

    ${mixins.flexAlignCenter};
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
`;

const WagerInfoPanelText = styled.span`
    font-weight: bold;
    font-family: clue, serif;
    text-shadow: 0.1em 0.1em #000;
`;

const TimerRow = styled(Row)`
    height: 20vh;
    ${mixins.flexAlignCenter}
`;

const BrowserWager = () => {
    const debug = useContext(DebugContext);

    const [maxWager, setMaxWager] = useState(debug ? 1000 : 0);
    const [boardController, setBoardController] = useState(debug ? samplePlayers['zsS3DKSSIUOegOQuAAAA'] : {});

    const [finalJeopartyClue, setFinalJeopartyClue] = useState(debug ? sampleCategories[0].clues[0] : {});
    const [showFinalJeopartyCategoryReveal, setShowFinalJeopartyCategoryReveal] = useState(debug ? false : true);
    const [revealFinalJeopartyCategory, setRevealFinalJeopartyCategory] = useState(false);
    const [currentWagersSubmitted, setCurrentWagersSubmitted] = useState(0);
    const [totalWagers, setTotalWagers] = useState(debug ? 4 : 0);

    const [wagerLivefeed, setWagerLivefeed] = useState('');
    const [showTimer, setShowTimer] = useState(false);
    const [startTimer, setStartTimer] = useState(false);

    const socket = useContext(SocketContext);

    useEffect(() => {
        socket.on('board_controller', (boardController, maxWager) => {
            setBoardController(boardController);
            setMaxWager(maxWager);
            setShowFinalJeopartyCategoryReveal(false);

            sayWagerFiller(5, maxWager, () => {
                socket.emit('start_wager_timer');
            });
        });

        socket.on('final_jeoparty_clue', (finalJeopartyClue) => {
            setFinalJeopartyClue(finalJeopartyClue);

            sayFinalJeopartyCategoryRevealIntroductionFiller(() => {
                const finalJeopartyPingAudio = new Audio(finalJeopartyPingSound);

                finalJeopartyPingAudio.onended = () => {
                    setRevealFinalJeopartyCategory(true);
                    sayCategoryRevealFiller(finalJeopartyClue.categoryName, finalJeopartyClue.year, () => {
                        setTimeout(() => {
                            setShowFinalJeopartyCategoryReveal(false);
                            sayFinalJeopartyWagerFiller(() => {
                                socket.emit('start_wager_timer');
                            });
                        }, 500);
                    });
                };

                finalJeopartyPingAudio.play();
            });
        });

        socket.on('start_wager_timer', () => {
            setTimeout(() => {
                setShowTimer(true);

                setTimeout(() => {
                    setStartTimer(true);
                }, 100);
            }, 100);
        });

        socket.on('wagers_submitted', (current, total) => {
            setCurrentWagersSubmitted(current);
            setTotalWagers(total);
        });

        socket.on('wager_livefeed', (wagerLivefeed) => {
            setWagerLivefeed(wagerLivefeed);
        });

        return () => {
            socket.off('board_controller');
            socket.off('final_jeoparty_clue');
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const WagerInfoPlayerCard = () => {
        return (
            <WagerInfoWrapper lg={'4'}>
                <WagerInfoRow>
                    <WagerInfoCol lg={'12'}>
                        <WagerInfoHeaderText>MIN</WagerInfoHeaderText>

                        <WagerInfoPanel>
                            <FitText compressor={1}>
                                <WagerInfoPanelText>$5</WagerInfoPanelText>
                            </FitText>
                        </WagerInfoPanel>
                    </WagerInfoCol>
                </WagerInfoRow>

                <WagerInfoRow>
                    <WagerInfoCol lg={'12'}>
                        <WagerInfoHeaderText>MAX</WagerInfoHeaderText>

                        <WagerInfoPanel>
                            <FitText compressor={1}>
                                <WagerInfoPanelText>${maxWager}</WagerInfoPanelText>
                            </FitText>
                        </WagerInfoPanel>
                    </WagerInfoCol>
                </WagerInfoRow>

                <WagerInfoRow>
                    <WagerInfoCol lg={'12'}>
                        <WagerInfoHeaderText>{_.invoke(_.get(boardController, 'name'), 'toUpperCase')}</WagerInfoHeaderText>

                        <WagerInfoPanel>
                            <FitText compressor={1}>
                                <WagerInfoPanelText>{`${_.isEmpty(wagerLivefeed) ? '' : '$'}${wagerLivefeed}`}</WagerInfoPanelText>
                            </FitText>
                        </WagerInfoPanel>
                    </WagerInfoCol>
                </WagerInfoRow>
            </WagerInfoWrapper>
        );
    };

    if (_.get(finalJeopartyClue, 'categoryName')) {
        return (
            <div>
                <FinalJeopartyCategoryRevealWrapper showFinalJeopartyCategoryReveal={showFinalJeopartyCategoryReveal}>
                    <CategoryReveal categoryName={_.get(finalJeopartyClue, 'categoryName', '')} categoryYear={_.get(finalJeopartyClue, 'year', '')} reveal={revealFinalJeopartyCategory} finalJeoparty={true} />
                </FinalJeopartyCategoryRevealWrapper>

                <FinalJeopartyBanner>
                    <FinalJeopartyLogoText>
                        FINAL JEOPARTY!
                    </FinalJeopartyLogoText>
                </FinalJeopartyBanner>

                <FinalJeopartyWagerContainer>
                    <FinalJeopartyWagerInfoText>
                        WAITING FOR WAGERS
                    </FinalJeopartyWagerInfoText>

                    <FinalJeopartyWagerPanel>
                        <FitText compressor={1.25}>
                            <WagerInfoPanelText>{currentWagersSubmitted}/{totalWagers} SUBMITTED</WagerInfoPanelText>
                        </FitText>
                    </FinalJeopartyWagerPanel>
                </FinalJeopartyWagerContainer>

                <TimerRow>
                    {showTimer && <Timer height={'6vh'} width={'60vw'} start={startTimer} time={timers.WAGER_TIMEOUT} slideUp={true} />}
                </TimerRow>
            </div>
        );
    } else {
        return (
            <div>
                <DailyDoubleBanner>
                    <mixins.DailyDoubleText style={{'font-size': '8vh'}}>
                        DAILY DOUBLE
                    </mixins.DailyDoubleText>
                </DailyDoubleBanner>

                <WagerInfoContainer fluid>
                    <Row>
                        <Col lg={'4'} />
                        <WagerInfoPlayerCard />
                        <Col lg={'4'} />
                    </Row>
                </WagerInfoContainer>

                <TimerRow>
                    {showTimer && <Timer height={'6vh'} width={'60vw'} start={startTimer} time={timers.WAGER_TIMEOUT} slideUp={true} />}
                </TimerRow>
            </div>
        );
    }
};

export default BrowserWager;
