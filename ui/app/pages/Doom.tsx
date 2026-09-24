// Doom page — wraps the DoomEmbed canvas in Strato layout chrome
import React from 'react';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import { DoomEmbed } from '../components/DoomEmbed';

export const Doom = () => {
  console.log('[DoomPage] rendered');
  return (
    <Flex flexDirection="column" alignItems="center" gap={16} padding={16}>
      <Heading level={2}>Yes, it will Doom. </Heading>
      <Paragraph>
        Doom Shareware Episode 1 — freely redistributable by id Software. Use arrow keys or WASD to
        move, Ctrl to shoot, Space to open doors.
      </Paragraph>
      <DoomEmbed width={1280} height={800} />
    </Flex>
  );
};
