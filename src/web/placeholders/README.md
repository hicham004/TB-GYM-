# Placeholders for the private pre-launch build

Stand-in photographs for showing the homepage privately before the shoot (UI plan R6.2h).
AI-generated people are allowed in this folder and nowhere else in TB Gym.

- Every file here except this README is git-ignored, so the pictures never enter the repository.
- The production build never copies this folder; only the private `placeholders` build does.
- The build check refuses any production output that refers to this folder.

Files the private build looks for (JPEG, landscape; any that exist are used, grey stand-ins for the rest):

| File        | What it shows                                                             |
| ----------- | ------------------------------------------------------------------------- |
| `hero.jpg`  | A coach beside a loaded barbell, reading a phone (the hero)               |
| `train.jpg` | A client between sets, phone in hand (the week's training stage)          |
| `talk.jpg`  | The coach and the client talking at the bar over a phone (the talk stage) |
| `team.jpg`  | Two coaches on a gym floor, each with a client (the gyms section)         |
