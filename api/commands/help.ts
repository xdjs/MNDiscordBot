import { InteractionResponseType } from 'discord-interactions';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

export async function help(userId: string) {
  const helpText = `For the best experience of this bot, turn on the Spotify status in your Discord status settings.
  \n\n
  \nHere are the available commands:
  \n/help - Show this help message
  \n/nerdout - Get a fun fact about the song you\'re currently listening to (only visible to you).
  \n/eavesdrop user<username> - See what track a user is currently playing (only you can see the result).
  \nTo make this work please connect Spotify to your Discord (Settings → Connections) and enable the \"Display current activity\" option.\nStart playing a song and then type /nerdout to get a fun fact.
  \n
  \n**Admins only:**
  \n/wrap - The bot will start listening to the spotify status of all users in a server and post daily wrap ups as 9:00pm (set your local time using /setime).
  \n/unwrap - The bot will stop listening to the spotify status of all users in a server and stop posting daily wrap ups (only admins can use this).
  \n/setime - enter your localtime so that the bot posts the wrap up at the correct time daily(format: hh:mm, example: 21:00)`;
  
  // Create (or fetch existing) DM channel with the user
  const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: userId }),
  });

  if (!dmRes.ok) {
    // Fall back with an error message if we cannot open a DM (likely because of privacy settings)
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content:
          "I couldn't send you a DM (check your privacy settings). Please allow DMs from server members and try again.",
      },
    };
  }

  const dmChannel = (await dmRes.json()) as { id: string };

  // Send the help text to the DM channel
  await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: helpText }),
  });

  // Acknowledge the command in the original channel
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: '📬 I\'ve sent you a DM with all available commands! Check your inbox.',
    },
  };
} 