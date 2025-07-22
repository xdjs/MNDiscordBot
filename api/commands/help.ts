import { InteractionResponseType } from 'discord-interactions';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

export async function help(userId: string) {
  const helpText = `For the best experience of this bot, please turn off message notification sounds in settings->notifications->message notifications->turn off.
  \n\n
  \nHere are the available commands:
  \n/help - Show this help message
  \n/hi - Say hi!
  \n/connect - Link your Spotify account
  \n/disconnect - Unlink your Spotify account
  \n/tracks - Get your top 10 Spotify tracks
  \n/profile - Gets a custom profile card displayed in the channel.
  \n/image - Generate a personalized picture of you listening to your top 10 Spotify tracks.
  \n/setimage - Use your generated image as profile background.
  \n/chat - Start a chat with the bot.(must have a text channel labeled "bot-chat")
  \n/listen - Give you fun facts about the artist you are listening to.
  \nTo make this work please connect Spotify to your Discord (Settings → Connections) and enable the \"Display current activity\" option.\nStart listening to a song and then type /listen to get fun facts about the artist.
  \n/listen user<username> - Give you fun facts about the artist that user is listening to. (has to have Spotify status enabled).
  \n/listen user<bot> - Give you fun facts about the artist that the music bot is playing.`;
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