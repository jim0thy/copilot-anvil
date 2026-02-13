import { useKeyboard } from '@opentui/react';
import { useState } from 'react';
import type { Theme } from '../theme.js';
import type { Skill } from '../../harness/Harness.js';

interface SkillsPaneProps {
  skills: Skill[];
  onSelect: (skillName: string) => void;
  onClose: () => void;
  theme: Theme;
  width: number;
  height: number;
}

export function SkillsPane({
  skills,
  onSelect,
  onClose,
  theme,
  width,
  height,
}: SkillsPaneProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useKeyboard((key) => {
    if (key.name === 'escape' || key.name === 'q') {
      onClose();
      return;
    }
    if (key.name === 'up') {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.name === 'down') {
      setSelectedIndex((i) => Math.min(skills.length - 1, i + 1));
      return;
    }
    if (key.name === 'return') {
      if (skills[selectedIndex]) {
        onSelect(skills[selectedIndex].name);
      }
      return;
    }
  });

  const modalWidth = Math.min(80, Math.floor(width * 0.8));
  const modalHeight = Math.min(30, Math.floor(height * 0.8));
  const left = Math.floor((width - modalWidth) / 2);
  const top = Math.floor((height - modalHeight) / 2);

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width={width}
      height={height}
    >
      <box
        position="absolute"
        top={top}
        left={left}
        width={modalWidth}
        height={modalHeight}
        flexDirection="column"
        backgroundColor={theme.colors.statusBarBg}
        borderStyle="double"
        borderColor={theme.colors.primary}
        padding={1}
      >
        {/* Header */}
        <box marginBottom={1}>
          <text>
            <span fg={theme.colors.primary}><b>⚡ Skills</b></span>
            {skills.length > 0 && (
              <span fg={theme.colors.muted}> - Select to invoke</span>
            )}
          </text>
        </box>

        {/* Content */}
        <box
          flexDirection="column"
          marginBottom={1}
        >
          {skills.length === 0 ? (
            <box>
              <text fg={theme.colors.muted}>No skills have been invoked yet</text>
            </box>
          ) : (
            skills.map((skill, index) => {
              const isSelected = selectedIndex === index;
              return (
                <box
                  key={skill.name}
                  marginBottom={index < skills.length - 1 ? 1 : 0}
                  flexDirection="column"
                >
                  <text>
                    <span fg={isSelected ? theme.colors.primary : theme.colors.muted}>
                      {isSelected ? '› ' : '  '}
                    </span>
                    <span fg={isSelected ? theme.colors.success : theme.colors.muted}>
                      <b>{skill.name}</b>
                    </span>
                    {skill.invokeCount > 0 && (
                      <span fg={theme.colors.muted}>
                        {' '}
                        (used {skill.invokeCount}x)
                      </span>
                    )}
                  </text>
                  {isSelected && (
                    <>
                      <text fg={theme.colors.muted}>
                        {'  '}Path: {skill.path}
                      </text>
                      {skill.invokeCount > 0 && (
                        <text fg={theme.colors.muted}>
                          {'  '}Last: {skill.invokedAt.toLocaleString()}
                        </text>
                      )}
                    </>
                  )}
                </box>
              );
            })
          )}
        </box>

        {/* Footer */}
        <box marginTop={1}>
          <text fg={theme.colors.muted}>
            {skills.length > 0 ? (
              <span>↑↓ navigate • Enter invoke • Esc cancel</span>
            ) : (
              <span>Press <span fg={theme.colors.primary}>esc</span> or <span fg={theme.colors.primary}>q</span> to close</span>
            )}
          </text>
        </box>
      </box>
    </box>
  );
}
