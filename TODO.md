1. A queue system
2. sleep timer / timeout system
3. The linux metadata and player controls works fine, but similar thing does not work on Zen (Firefox) browser
4. fix the gap between switching the modes, it has to be like this but for some reason there is a delay and it visibly goes from 1 to the exact resume position. not smooth. The proceess:
when switching the mix, the currently playing audio would continue playing untill the next one is ready to be switched. Make sure the next mix starts from where original stops. Make sure that this switch is smooth, meaning there is no quiteness gap when switch happens, maybe by overlapping two audio a small bit to cover that switch gap.
5. within generate modal, we still have those -12, -16 ... instead of normal, loud and quiet.
6. I did some changes and i think i broke the generation process maybe this queue was the reason why #4 process broke. And ui does not display the progress and remaing mix generation.
7. regarding artist, genre, years, and albums part. I think it would be nice if we could edit the thumbnail of them. + when setting default image of the artist, if possible take it from the publisher's channel pfp.
