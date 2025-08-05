import { InteractionResponseType } from 'discord-interactions';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

export async function help(userId: string) {
  const helpText = `For the best experience of this bot, please turn off message notification sounds in settings->notifications->message notifications->turn off.
  \n\n
  \nHere are the available commands:
  \n/help - Show this help message






  
  \n/listen start - Give you fun facts about the artist you are listening to.
  \nTo make this work please connect Spotify to your Discord (Settings → Connections) and enable the \"Display current activity\" option.\nStart listening to a song and then type /listen to get fun facts about the artist.
  \n/listen start user<username> - Give you fun facts about the artist that user is listening to. (has to have Spotify status enabled).
  \n/listen start user<bot> - Give you fun facts about the artist that the music bot is playing.
  \n/listen start dm:(true/false) - true = send the facts to your DMs, false = send the facts to the serverchannel.(like a switch)
  \n/listen end (@user) - force ends the listening session.
  \n\n
  \n/wrap - The bot will start listening to the spotify status of all users in a server and post daily wrap ups as 11:50pm (set your local time using /setime).
  \n/unwrap - The bot will stop listening to the spotify status of all users in a server and stop posting daily wrap ups (only admins can use this).
  \nsetime - enter your localtime so that the bot posts the wrap up at the correct time`;
  
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