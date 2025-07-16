import { InteractionResponseType } from 'discord-interactions';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;
const TARGET_CHANNEL_NAME = 'bot-chat';

/**
 * /chat command: Posts a prompt in #bot-chat (creates nothing if channel missing).
 */
export async function chat(guildId: string | undefined, _interactionChannelId: string) {
  if (!guildId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '⚠️ This command must be used inside a server.',
        flags: 64, // ephemeral
      },
    };
  }

  // 1. Look for a text channel named TARGET_CHANNEL_NAME in the guild
  let botChatId: string | null = null;
  try {
    const resp = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
      },
    });

    if (resp.ok) {
      const channels = (await resp.json()) as Array<any>;
      const match = channels.find(
        (ch) => ch.type === 0 /* GUILD_TEXT */ && ch.name === TARGET_CHANNEL_NAME,
      );
      if (match) botChatId = match.id;
    } else {
      console.error('Failed to fetch guild channels', await resp.text());
    }
  } catch (err) {
    console.error('Error fetching guild channels', err);
  }

  if (!botChatId) {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: `⚠️ Please create a #${TARGET_CHANNEL_NAME} channel first.`,
        flags: 64, // ephemeral
      },
    };
  }

  // 2. Post the prompt inside #bot-chat
  try {
    await fetch(`https://discord.com/api/v10/channels/${botChatId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: 'What questions do you have?' }),
    });

    // After posting prompt, notify Render chat hook (if env set)
    const CHAT_HOOK_URL = process.env.CHAT_HOOK_URL;
    if (CHAT_HOOK_URL) {
      try {
        const resp = await fetch(CHAT_HOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel_id: botChatId }),
        });
        console.log('[chat-hook] status', resp.status);
        if (!resp.ok) console.log('[chat-hook] body', await resp.text());
      } catch (err) {
        console.error('Failed to hit chat hook', err);
      }
    }
  } catch (err) {
    console.error('Failed to post message to #bot-chat', err);
    // We can still acknowledge the command even if posting fails
  }

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `✅ Prompt posted in #${TARGET_CHANNEL_NAME}!`,
      flags: 64, // ephemeral
    },
  };
} 