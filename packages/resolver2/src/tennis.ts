import { Channel } from './channel';

enum Direction {
  Left = 'left',
  Right = 'right',
}
type Ball = { direction: Direction; hits: number };

const timeout = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// const batter = async (incoming: Channel<Ball>, outgoing: Channel<Ball>) => {
//   for await (const ball of incoming) {
//     console.log(`🎾 Ball hit ${ball.hits} time(s), receiving it from the ${ball.direction}`);

//     await timeout(100);

//     if (outgoing.open) {
//       outgoing.put({
//         hits: ball.hits + 1,
//         direction: ball.direction === Direction.Left ? Direction.Right : Direction.Left,
//       });
//     }
//   }
// };

async function tennis() {
  const left = new Channel<Ball>();
  const right = new Channel<Ball>();

  setTimeout(() => {
    left.close();
    right.close();
  }, 1000);

  left.put({ direction: Direction.Right, hits: 0 });

  for await (const { key: side, value: ball } of Channel.select({ left, right })) {
    switch (side) {
      case Direction.Left:
        console.log(
          `🎾 received the ball on the left, going ${ball.direction} after ${ball.hits} hit(s)`
        );
        right.put({ direction: Direction.Left, hits: ball.hits + 1 });
        break;

      case Direction.Right:
        console.log(
          `🎾 received the ball on the right, going ${ball.direction} after ${ball.hits} hit(s)`
        );
        left.put({ direction: Direction.Left, hits: ball.hits + 1 });
        break;
    }

    await timeout(100);
  }

  console.log(`🛑 All done for today, time to put away your rackets`);
}

tennis();
