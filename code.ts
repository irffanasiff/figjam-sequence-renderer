class Logger {
  private static instance: Logger;

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private log(level: string, message: string, data?: unknown) {
    const timestamp = new Date().toISOString();

    console.log(
      `[${timestamp}] ${level.toUpperCase()}: ${message}`,
      data || ''
    );

    // Send to UI for display
    figma.ui.postMessage({
      type: 'debug',
      message: `${level.toUpperCase()}: ${message}`,
      data,
    });
  }

  debug(message: string, data?: unknown) {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown) {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown) {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown) {
    this.log('error', message, data);
  }
}

const logger = Logger.getInstance();

// Show the UI
figma.showUI(__html__, {
  width: 450,
  height: 700,
  themeColors: true,
});

logger.info('Plugin started, UI shown');

interface Participant {
  id: string;
  name: string;
  alias?: string;
}

interface Message {
  from: string;
  to: string;
  text: string;
  type: 'sync' | 'async' | 'response';
  isSelf?: boolean;
}

interface Note {
  text: string;
  participants: string[];
  position: 'over' | 'left' | 'right';
  messageIndex?: number; // Track where this note appears relative to messages
}

interface Section {
  type: 'rect' | 'alt' | 'opt' | 'loop' | 'par' | 'critical' | 'break';
  label?: string;
  color?: string;
  startIndex: number;
  endIndex: number;
  items: (Message | Note)[];
  condition?: string; // For alt/opt conditions
}

interface ParsedSequence {
  participants: Participant[];
  messages: Message[];
  notes: Note[];
  sections: Section[]; // Add sections to the parsed result
}

interface SequenceFlowItem {
  type: 'message' | 'note';
  item: Message | Note;
  yPosition: number;
  index: number;
}

interface SequenceFlow {
  items: SequenceFlowItem[];
  totalHeight: number;
}

class MermaidSequenceParser {
  private participants: Map<string, Participant> = new Map();
  private messages: Message[] = [];
  private notes: Note[] = [];
  private sections: Section[] = [];
  private sequenceItems: (Message | Note)[] = []; // Track all sequence items in order
  private sectionStack: Partial<Section>[] = []; // Stack for nested sections

  parse(mermaidCode: string): ParsedSequence {
    logger.info('Starting to parse Mermaid code');
    logger.debug('Input code', { code: mermaidCode });

    this.participants.clear();
    this.messages = [];
    this.notes = [];
    this.sections = [];
    this.sequenceItems = [];
    this.sectionStack = [];

    const lines = mermaidCode
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('%%'));

    logger.debug('Processed lines', {
      totalLines: lines.length,
      lines: lines,
    });

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      logger.debug(`Parsing line ${i + 1}`, { line });

      if (line.startsWith('sequenceDiagram')) {
        logger.debug('Found sequenceDiagram declaration');
        continue;
      }

      try {
        this.parseLine(line);
      } catch (error) {
        logger.error(`Error parsing line ${i + 1}: "${line}"`, {
          error: error instanceof Error ? error.message : error,
        });
        throw new Error(
          `Parse error on line ${i + 1}: "${line}" - ${
            error instanceof Error ? error.message : error
          }`
        );
      }
    }

    const result = {
      participants: Array.from(this.participants.values()),
      messages: this.messages,
      notes: this.notes,
      sections: this.sections,
    };

    logger.info('Parsing completed', {
      participantCount: result.participants.length,
      messageCount: result.messages.length,
      noteCount: result.notes.length,
      sectionCount: result.sections.length,
      sequenceItemCount: this.sequenceItems.length,
    });

    return result;
  }

  private parseLine(line: string) {
    logger.debug('Parsing line', {
      line,
      length: line.length,
      charCodes: line
        .split('')
        .map((c) => c.charCodeAt(0))
        .slice(0, 10), // First 10 character codes
    });

    // Parse section start markers (rect, alt, opt, loop, par, critical)
    const sectionStartMatch = line.match(
      /^(rect|alt|opt|loop|par|critical|break)(?:\s+(.+))?/
    );
    if (sectionStartMatch) {
      const [, sectionType, condition] = sectionStartMatch;
      logger.debug('Section start found', { sectionType, condition });

      let color: string | undefined;
      let label: string | undefined = condition;

      // Handle rect with color: "rect rgb(255, 245, 238)"
      if (sectionType === 'rect' && condition) {
        const colorMatch = condition.match(/rgb\(([^)]+)\)/);
        if (colorMatch) {
          color = colorMatch[0];
          label = condition.replace(/rgb\([^)]+\)/, '').trim() || undefined;
        }
      }

      const section: Partial<Section> = {
        type: sectionType as Section['type'],
        label,
        color,
        condition:
          sectionType === 'alt' || sectionType === 'opt'
            ? condition
            : undefined,
        startIndex: this.sequenceItems.length,
        items: [],
      };

      this.sectionStack.push(section);
      logger.info('Started section', {
        section,
        stackDepth: this.sectionStack.length,
      });
      return;
    }

    // Parse section end marker
    if (line === 'end') {
      if (this.sectionStack.length > 0) {
        const completedSection = this.sectionStack.pop()!;
        completedSection.endIndex = this.sequenceItems.length;

        if (
          completedSection.type &&
          completedSection.startIndex !== undefined &&
          completedSection.endIndex !== undefined
        ) {
          this.sections.push(completedSection as Section);
          logger.info('Completed section', {
            section: completedSection,
            totalSections: this.sections.length,
          });
        }
      } else {
        logger.warn('Found "end" without matching section start');
      }
      return;
    }

    // Parse section else/alternative markers
    const elseMatch = line.match(/^else(?:\s+(.+))?/);
    if (elseMatch && this.sectionStack.length > 0) {
      const [, elseCondition] = elseMatch;
      const currentSection = this.sectionStack[this.sectionStack.length - 1];

      // End current section and start new else section
      if (currentSection) {
        currentSection.endIndex = this.sequenceItems.length;

        if (currentSection.type && currentSection.startIndex !== undefined) {
          this.sections.push(currentSection as Section);
        }

        // Start new else section
        const elseSection: Partial<Section> = {
          type: 'alt', // else is part of alt
          label: elseCondition || 'else',
          condition: elseCondition,
          startIndex: this.sequenceItems.length,
          items: [],
        };

        this.sectionStack[this.sectionStack.length - 1] = elseSection;
        logger.info('Started else section', { elseSection });
      }
      return;
    }

    // Parse section 'and' markers for parallel sections
    const andMatch = line.match(/^and(?:\s+(.+))?/);
    if (andMatch && this.sectionStack.length > 0) {
      const [, andCondition] = andMatch;
      const currentSection = this.sectionStack[this.sectionStack.length - 1];

      // For 'and' in parallel sections, we continue the same section but note the separation
      if (currentSection && currentSection.type === 'par') {
        // Just log the 'and' separator but continue the same parallel section
        logger.info('Found parallel separator "and"', {
          andCondition,
          currentParallelSection: currentSection,
        });
      } else {
        logger.warn('Found "and" outside of parallel section context');
      }
      return;
    }

    // Parse participant definitions with enhanced regex to handle emojis and HTML breaks
    const participantMatch = line.match(/participant\s+(\w+)(?:\s+as\s+(.+))?/);
    if (participantMatch) {
      const [, id, alias] = participantMatch;
      logger.debug('Participant match found', { id, alias });

      // Enhanced cleanup for HTML break tags, emojis, and formatting
      let cleanAlias = alias;
      if (cleanAlias) {
        // Replace HTML break tags with actual line breaks for display
        cleanAlias = cleanAlias
          .replace(/<br\s*\/?>/gi, '\n') // Convert <br> to newlines
          .replace(/&nbsp;/gi, ' ') // Convert HTML spaces
          .trim();
      }

      const participant = {
        id,
        name: cleanAlias || id,
        alias: cleanAlias,
      };
      this.participants.set(id, participant);
      logger.info('Added participant', {
        participant,
        totalParticipants: this.participants.size,
        hasEmoji:
          /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(
            cleanAlias || ''
          ),
        hasLineBreak: (cleanAlias || '').includes('\n'),
      });
      return;
    }

    // Parse messages with enhanced arrow detection - FIXED ARROW TYPES
    logger.debug('Attempting message match', {
      line,
      regexPattern: '(\\w+)\\s*(-->>|->>|->)\\s*(\\w+):\\s*(.+)',
    });

    const messageMatch = line.match(/(\w+)\s*(-->>|->>|->)\s*(\w+):\s*(.+)/);
    if (messageMatch) {
      const [fullMatch, from, arrow, to, text] = messageMatch;
      logger.debug('Message match found', { fullMatch, from, arrow, to, text });

      // Ensure participants exist
      if (!this.participants.has(from)) {
        const participant = { id: from, name: from };
        this.participants.set(from, participant);
        logger.info('Auto-created participant', {
          participant,
          reason: 'message sender',
        });
      }
      if (!this.participants.has(to)) {
        const participant = { id: to, name: to };
        this.participants.set(to, participant);
        logger.info('Auto-created participant', {
          participant,
          reason: 'message receiver',
        });
      }

      // FIXED: Correct Mermaid arrow type mapping
      let type: 'sync' | 'async' | 'response' = 'sync';
      if (arrow === '-->>') {
        type = 'response'; // Dashed arrow, typically for responses/async
      } else if (arrow === '->>') {
        type = 'sync'; // Solid arrow with filled arrowhead
      } else if (arrow === '->') {
        type = 'async'; // Simple arrow
      }

      const message = {
        from,
        to,
        text: text.trim(),
        type,
        isSelf: from === to,
      };

      this.messages.push(message);
      this.sequenceItems.push(message);

      // Add message to current section if we're inside one
      if (this.sectionStack.length > 0) {
        const currentSection = this.sectionStack[this.sectionStack.length - 1];
        if (currentSection.items) {
          currentSection.items.push(message);
        }
      }

      logger.info('Added message', {
        message,
        totalMessages: this.messages.length,
        messageType: type,
        isSelfMessage: message.isSelf,
        currentIndex: this.sequenceItems.length,
        arrowType: arrow,
        isInSection: this.sectionStack.length > 0,
      });
      return;
    } else {
      logger.debug('Message regex did not match', { line });
    }

    // Parse notes with enhanced regex for different note formats and spanning
    const noteMatch = line.match(
      /Note\s+(over|left\s+of|right\s+of)\s+([^:]+):\s*(.+)/i
    );
    if (noteMatch) {
      const [, position, participantStr, text] = noteMatch;
      logger.debug('Note match found', { position, participantStr, text });

      // Enhanced participant parsing for spanning notes
      const participants = participantStr
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      // Map position string to the correct union type
      let notePosition: 'over' | 'left' | 'right';
      if (position.toLowerCase() === 'over') {
        notePosition = 'over';
      } else if (position.toLowerCase().includes('left')) {
        notePosition = 'left';
      } else if (position.toLowerCase().includes('right')) {
        notePosition = 'right';
      } else {
        notePosition = 'over';
        logger.warn('Unknown note position, defaulting to over', { position });
      }

      const note = {
        text: text.trim(),
        participants,
        position: notePosition,
        messageIndex: this.sequenceItems.length,
      };

      this.notes.push(note);
      this.sequenceItems.push(note);

      // Add note to current section if we're inside one
      if (this.sectionStack.length > 0) {
        const currentSection = this.sectionStack[this.sectionStack.length - 1];
        if (currentSection.items) {
          currentSection.items.push(note);
        }
      }

      logger.info('Added note', {
        note,
        totalNotes: this.notes.length,
        affectedParticipants: participants.length,
        isSpanning: participants.length > 1,
        participantList: participants,
        isInSection: this.sectionStack.length > 0,
      });
      return;
    }

    // Handle comment lines (starting with %% or empty lines)
    if (line.startsWith('%%') || line.trim() === '') {
      logger.debug('Skipping comment or empty line', { line });
      return;
    }

    // If we get here, the line wasn't recognized
    logger.warn('Unrecognized line format', {
      line,
      lineLength: line.length,
      firstChar: line.charAt(0),
      trimmed: line.trim(),
    });
  }
}

class SequenceDiagramRenderer {
  private readonly PARTICIPANT_WIDTH = 220; // Increased for better readability
  private readonly PARTICIPANT_HEIGHT = 90; // Increased for better readability
  private readonly LIFELINE_SPACING = 300; // Increased spacing between participants
  private readonly MESSAGE_SPACING = 140; // Increased vertical spacing between messages
  private readonly NOTE_HEIGHT = 70; // Standard note height
  private readonly NOTE_MIN_WIDTH = 180; // Minimum note width
  private readonly START_Y = 150;
  private readonly START_X = 150; // Increased left margin

  // Centralized font loading to ensure consistency
  private async loadFonts() {
    try {
      await figma.loadFontAsync({ family: 'Inter', style: 'Medium' });
      await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
      logger.debug('Fonts loaded successfully');
    } catch (error) {
      logger.warn('Error loading preferred fonts, falling back to default', {
        error,
      });
      // Fallback to default font if Inter is not available
      try {
        await figma.loadFontAsync({ family: 'Roboto', style: 'Regular' });
        await figma.loadFontAsync({ family: 'Roboto', style: 'Bold' });
        logger.debug('Fallback fonts loaded successfully');
      } catch (fallbackError) {
        logger.error('Failed to load any fonts', { fallbackError });
        throw new Error('Unable to load required fonts for text rendering');
      }
    }
  }

  async render(parsed: ParsedSequence) {
    logger.info('Starting diagram rendering with sections support', {
      participantCount: parsed.participants.length,
      messageCount: parsed.messages.length,
      noteCount: parsed.notes.length,
      sectionCount: parsed.sections.length,
    });

    try {
      // Load fonts first before creating any text nodes
      await this.loadFonts();

      const nodes: SceneNode[] = [];

      // Calculate positions
      const participantPositions = this.calculateParticipantPositions(
        parsed.participants
      );

      // Create the sequence flow - this determines the Y positions for messages and notes
      const sequenceFlow = this.createSequenceFlow(
        parsed.messages,
        parsed.notes
      );

      // Create sections FIRST as background containers
      const sectionNodes = await this.createSectionBackgrounds(
        parsed.sections,
        participantPositions,
        sequenceFlow
      );
      nodes.push(...sectionNodes);

      // Create participants
      const participantNodes = await this.createParticipants(
        parsed.participants,
        participantPositions
      );
      nodes.push(...participantNodes);

      // Create lifelines that extend through the entire sequence
      const lifelineNodes = await this.createLifelines(
        parsed.participants,
        participantPositions,
        sequenceFlow.totalHeight
      );
      nodes.push(...lifelineNodes);

      // Create messages at their sequence positions
      const messageNodes = await this.createMessages(
        parsed.messages,
        participantPositions,
        sequenceFlow
      );
      nodes.push(...messageNodes);

      // Create notes at their proper sequence positions
      const noteNodes = await this.createNotes(
        parsed.notes,
        participantPositions,
        sequenceFlow
      );
      nodes.push(...noteNodes);

      // Group all elements
      const group = figma.group(nodes, figma.currentPage);
      group.name = 'Mermaid Sequence Diagram';

      // Center the diagram in viewport
      figma.viewport.scrollAndZoomIntoView([group]);

      logger.info('Diagram rendering completed successfully', {
        totalNodes: nodes.length,
        sequenceItems: sequenceFlow.items.length,
        totalHeight: sequenceFlow.totalHeight,
        sectionsRendered: sectionNodes.length,
      });

      return group;
    } catch (error) {
      logger.error('Error during rendering', { error });
      throw error;
    }
  }

  private calculateParticipantPositions(
    participants: Participant[]
  ): Map<string, { x: number; y: number }> {
    const positions = new Map();

    participants.forEach((participant, index) => {
      const position = {
        x: this.START_X + index * this.LIFELINE_SPACING,
        y: this.START_Y,
      };
      positions.set(participant.id, position);
    });

    return positions;
  }

  private createSequenceFlow(messages: Message[], notes: Note[]): SequenceFlow {
    // Create a sequential flow based on the order items were parsed
    const items: SequenceFlowItem[] = [];
    let currentY =
      this.START_Y + this.PARTICIPANT_HEIGHT + this.MESSAGE_SPACING;

    // Process all sequence items in their original order
    // We need to rebuild the sequence from the original parsing order
    // For now, we'll use the existing message/note separation but with proper ordering

    // First, create a combined list with proper ordering based on messageIndex for notes
    const allItems: Array<{
      item: Message | Note;
      type: 'message' | 'note';
      originalIndex: number;
    }> = [];

    // Add all messages with their index
    messages.forEach((message, index) => {
      allItems.push({
        item: message,
        type: 'message',
        originalIndex: index,
      });
    });

    // Add all notes, positioned based on their messageIndex
    notes.forEach((note) => {
      const insertIndex =
        note.messageIndex !== undefined ? note.messageIndex : allItems.length;
      allItems.push({
        item: note,
        type: 'note',
        originalIndex: insertIndex,
      });
    });

    // Sort by original index to maintain proper sequence order
    allItems.sort((a, b) => a.originalIndex - b.originalIndex);

    // Create sequence flow items with proper Y positioning
    allItems.forEach((itemWrapper, sequenceIndex) => {
      items.push({
        type: itemWrapper.type,
        item: itemWrapper.item,
        yPosition: currentY,
        index: sequenceIndex,
      });
      currentY += this.MESSAGE_SPACING;
    });

    return {
      items,
      totalHeight: currentY - this.START_Y + this.MESSAGE_SPACING,
    };
  }

  private async createParticipants(
    participants: Participant[],
    positions: Map<string, { x: number; y: number }>
  ): Promise<ShapeWithTextNode[]> {
    const nodes: ShapeWithTextNode[] = [];

    for (const participant of participants) {
      const pos = positions.get(participant.id)!;

      try {
        const shape = figma.createShapeWithText();
        shape.shapeType = 'ROUNDED_RECTANGLE';
        shape.x = pos.x - this.PARTICIPANT_WIDTH / 2;
        shape.y = pos.y;
        shape.resize(this.PARTICIPANT_WIDTH, this.PARTICIPANT_HEIGHT);

        // Enhanced participant styling for better visibility
        shape.fills = [{ type: 'SOLID', color: { r: 0.96, g: 0.98, b: 1 } }];
        shape.strokes = [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8 } }];
        shape.strokeWeight = 2.5;
        shape.name = `Participant: ${participant.name}`;

        // Enhanced text properties for better readability
        shape.text.fontName = { family: 'Inter', style: 'Bold' };
        shape.text.characters = participant.name;
        shape.text.fontSize = 14;
        shape.text.fills = [
          { type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } },
        ];

        nodes.push(shape);

        logger.debug('Created participant with enhanced styling', {
          name: participant.name,
          position: pos,
          dimensions: {
            width: this.PARTICIPANT_WIDTH,
            height: this.PARTICIPANT_HEIGHT,
          },
        });
      } catch (error) {
        logger.error(`Error creating participant ${participant.name}`, {
          error,
        });
        throw error;
      }
    }

    return nodes;
  }

  private async createLifelines(
    participants: Participant[],
    positions: Map<string, { x: number; y: number }>,
    totalHeight: number
  ): Promise<ConnectorNode[]> {
    const nodes: ConnectorNode[] = [];

    for (const participant of participants) {
      const pos = positions.get(participant.id)!;

      try {
        const lifeline = figma.createConnector();
        lifeline.strokeWeight = 2;
        lifeline.strokes = [
          { type: 'SOLID', color: { r: 0.3, g: 0.3, b: 0.3 } },
        ];
        lifeline.dashPattern = [5, 3];
        lifeline.name = `Lifeline: ${participant.id}`;
        lifeline.connectorLineType = 'STRAIGHT';

        // Lifeline extends from bottom of participant to end of sequence
        lifeline.connectorStart = {
          position: { x: pos.x, y: pos.y + this.PARTICIPANT_HEIGHT },
        };
        lifeline.connectorEnd = {
          position: { x: pos.x, y: pos.y + totalHeight },
        };

        lifeline.connectorStartStrokeCap = 'NONE';
        lifeline.connectorEndStrokeCap = 'NONE';

        nodes.push(lifeline);
      } catch (error) {
        logger.error(`Error creating lifeline for ${participant.id}`, {
          error,
        });
        throw error;
      }
    }
    return nodes;
  }

  private async createMessages(
    messages: Message[],
    positions: Map<string, { x: number; y: number }>,
    sequenceFlow: SequenceFlow
  ): Promise<SceneNode[]> {
    const nodes: SceneNode[] = [];

    const messageItems = sequenceFlow.items.filter(
      (item: SequenceFlowItem) => item.type === 'message'
    );

    for (const flowItem of messageItems) {
      const message = flowItem.item as Message;
      const fromPos = positions.get(message.from);
      const toPos = positions.get(message.to);

      if (!fromPos || !toPos) {
        logger.error('Missing position for message participants', { message });
        continue;
      }

      const y = flowItem.yPosition;

      try {
        if (message.isSelf) {
          const selfLoopNodes = await this.createSelfMessageLoop(
            message,
            fromPos.x,
            y
          );
          nodes.push(...selfLoopNodes);
        } else {
          const connector = figma.createConnector();
          connector.name = `Message: ${message.from} to ${message.to}`;
          connector.connectorLineType = 'STRAIGHT';

          connector.connectorStart = { position: { x: fromPos.x, y: y } };
          connector.connectorEnd = { position: { x: toPos.x, y: y } };

          // Set message text using native connector text
          connector.text.characters = message.text;
          connector.text.fontName = { family: 'Inter', style: 'Medium' };
          connector.text.fontSize = 14;
          connector.text.fills = [
            { type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } },
          ];

          // FIXED: Correct arrow directions and styling based on Mermaid standards
          if (message.type === 'response') {
            // -->> arrows: dashed line, arrow points in direction of flow (from sender to receiver)
            connector.strokes = [
              { type: 'SOLID', color: { r: 0.2, g: 0.6, b: 0.9 } },
            ];
            connector.strokeWeight = 2.5;
            connector.dashPattern = [8, 4]; // Dashed pattern for response
            connector.connectorStartStrokeCap = 'NONE';
            connector.connectorEndStrokeCap = 'ARROW_LINES'; // Arrow points TO the receiver
          } else if (message.type === 'sync') {
            // ->> arrows: solid line with filled arrowhead
            connector.strokes = [
              { type: 'SOLID', color: { r: 0.2, g: 0.6, b: 0.9 } },
            ];
            connector.strokeWeight = 3;
            connector.connectorStartStrokeCap = 'NONE';
            connector.connectorEndStrokeCap = 'ARROW_LINES'; // Using ARROW_LINES for filled appearance with thicker stroke
          } else if (message.type === 'async') {
            // -> arrows: simple solid line with open arrowhead
            connector.strokes = [
              { type: 'SOLID', color: { r: 0.4, g: 0.7, b: 0.3 } },
            ];
            connector.strokeWeight = 2.5;
            connector.connectorStartStrokeCap = 'NONE';
            connector.connectorEndStrokeCap = 'ARROW_LINES'; // Open arrow for async
          }

          nodes.push(connector);

          logger.debug('Created message arrow with correct direction', {
            from: message.from,
            to: message.to,
            type: message.type,
            text: message.text.substring(0, 30),
            arrowDirection: `${fromPos.x} -> ${toPos.x}`,
          });
        }
      } catch (error) {
        logger.error(`Error creating message: ${message.text}`, { error });
        throw error;
      }
    }
    return nodes;
  }

  private async createSelfMessageLoop(
    message: Message,
    x: number,
    y: number
  ): Promise<SceneNode[]> {
    const nodes: SceneNode[] = [];

    try {
      // Create the curved connector for self-message
      const selfConnector = figma.createConnector();
      selfConnector.name = `Self Message: ${message.text}`;
      selfConnector.connectorLineType = 'CURVED';

      // Improved positioning for better curve visibility
      const loopWidth = 80;
      const loopHeight = 50;
      selfConnector.connectorStart = {
        position: { x: x + 10, y: y - loopHeight / 2 },
      };
      selfConnector.connectorEnd = {
        position: { x: x + 10, y: y + loopHeight / 2 },
      };

      // FIXED: Apply same styling conventions as regular messages
      if (message.type === 'response') {
        // -->> self arrows: dashed line
        selfConnector.strokes = [
          { type: 'SOLID', color: { r: 0.2, g: 0.6, b: 0.9 } },
        ];
        selfConnector.strokeWeight = 2.5;
        selfConnector.dashPattern = [8, 4];
      } else if (message.type === 'sync') {
        // ->> self arrows: solid line with filled arrowhead
        selfConnector.strokes = [
          { type: 'SOLID', color: { r: 0.2, g: 0.6, b: 0.9 } },
        ];
        selfConnector.strokeWeight = 3;
      } else if (message.type === 'async') {
        // -> self arrows: simple solid line
        selfConnector.strokes = [
          { type: 'SOLID', color: { r: 0.4, g: 0.7, b: 0.3 } },
        ];
        selfConnector.strokeWeight = 2.5;
      }

      selfConnector.connectorStartStrokeCap = 'NONE';
      selfConnector.connectorEndStrokeCap = 'ARROW_LINES';

      // Set text properties
      selfConnector.text.characters = message.text;
      selfConnector.text.fontName = { family: 'Inter', style: 'Medium' };
      selfConnector.text.fontSize = 12;
      selfConnector.text.fills = [
        { type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } },
      ];

      nodes.push(selfConnector);

      logger.debug('Created self-message with consistent styling', {
        text: message.text,
        position: { x: x, y: y },
        messageType: message.type,
        loopDimensions: { width: loopWidth, height: loopHeight },
      });
    } catch (error) {
      logger.error('Error creating self-message connector', {
        error,
        message: message.text,
      });

      // Simple fallback: create a basic rectangle indicator
      const rect = figma.createRectangle();
      rect.x = x + 20;
      rect.y = y - 15;
      rect.resize(60, 30);
      rect.fills = [];
      rect.strokes = [{ type: 'SOLID', color: { r: 0.2, g: 0.6, b: 0.2 } }];
      rect.strokeWeight = 2;
      rect.cornerRadius = 15;
      rect.name = `Self Message: ${message.text}`;

      nodes.push(rect);
    }

    return nodes;
  }

  private async createNotes(
    notes: Note[],
    positions: Map<string, { x: number; y: number }>,
    sequenceFlow: SequenceFlow
  ): Promise<ShapeWithTextNode[]> {
    const nodes: ShapeWithTextNode[] = [];

    const noteItems = sequenceFlow.items.filter(
      (item: SequenceFlowItem) => item.type === 'note'
    );

    for (const flowItem of noteItems) {
      const note = flowItem.item as Note;
      const y = flowItem.yPosition;

      try {
        const noteShape = figma.createShapeWithText();
        noteShape.shapeType = 'ROUNDED_RECTANGLE';
        noteShape.name = `Note: ${note.text.substring(0, 30)}`;

        // Simplified note positioning logic
        let noteX = 0;
        let noteWidth = this.NOTE_MIN_WIDTH;

        // Calculate horizontal position based on participants
        if (note.participants.length === 1) {
          // Single participant note
          const participantPos = positions.get(note.participants[0]);
          if (participantPos) {
            noteX = participantPos.x;
            if (note.position === 'right') {
              noteX += this.PARTICIPANT_WIDTH / 2 + 80;
            } else if (note.position === 'left') {
              noteX -= this.PARTICIPANT_WIDTH / 2 + 80;
            }
            // For 'over' position, keep centered on participant
          }
        } else if (note.participants.length > 1) {
          // Spanning note - center between first and last participants
          const firstPos = positions.get(note.participants[0]);
          const lastPos = positions.get(
            note.participants[note.participants.length - 1]
          );

          if (firstPos && lastPos) {
            noteX = (firstPos.x + lastPos.x) / 2;
            noteWidth = Math.abs(lastPos.x - firstPos.x) + 100;
          }
        } else {
          // Default positioning if no specific participants
          const allPositions = Array.from(positions.values());
          if (allPositions.length > 0) {
            const avgX =
              allPositions.reduce((sum, pos) => sum + pos.x, 0) /
              allPositions.length;
            noteX = avgX;
          }
        }

        // Ensure minimum width and calculate based on text length
        const textLength = note.text.length;
        const calculatedWidth = Math.max(
          textLength * 8 + 40, // Simple text width estimation
          noteWidth,
          this.NOTE_MIN_WIDTH
        );

        // Set final dimensions and position
        noteShape.resize(calculatedWidth, this.NOTE_HEIGHT);
        noteShape.x = noteX - calculatedWidth / 2;
        noteShape.y = y - this.NOTE_HEIGHT / 2;

        // Apply note styling
        noteShape.fills = [{ type: 'SOLID', color: { r: 1, g: 0.95, b: 0.3 } }];
        noteShape.strokes = [
          { type: 'SOLID', color: { r: 0.9, g: 0.8, b: 0.1 } },
        ];
        noteShape.strokeWeight = 2;

        // Set text content and styling
        noteShape.text.characters = note.text;
        noteShape.text.fontName = { family: 'Inter', style: 'Medium' };
        noteShape.text.fontSize = 13;
        noteShape.text.fills = [
          { type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.1 } },
        ];

        nodes.push(noteShape);

        logger.debug('Created note with simplified positioning', {
          text: note.text.substring(0, 30),
          position: { x: noteX, y: y },
          size: { width: calculatedWidth, height: this.NOTE_HEIGHT },
          participants: note.participants,
          notePosition: note.position,
        });
      } catch (error) {
        logger.error(`Error creating note: ${note.text}`, { error });
        throw error;
      }
    }

    return nodes;
  }

  private async createSectionBackgrounds(
    sections: Section[],
    positions: Map<string, { x: number; y: number }>,
    sequenceFlow: SequenceFlow
  ): Promise<SceneNode[]> {
    const nodes: SceneNode[] = [];

    for (const section of sections) {
      try {
        // Create section background frame
        const sectionFrame = figma.createFrame();

        // Create the proper section title based on Mermaid syntax
        let sectionTitle = '';
        switch (section.type) {
          case 'rect':
            sectionTitle = section.label || '📦 Section';
            break;
          case 'alt':
            sectionTitle = section.condition
              ? `alt [${section.condition}]`
              : 'alt [Alternative]';
            break;
          case 'opt':
            sectionTitle = section.condition
              ? `opt [${section.condition}]`
              : 'opt [Optional]';
            break;
          case 'loop':
            sectionTitle = section.condition
              ? `loop [${section.condition}]`
              : 'loop [Iteration]';
            break;
          case 'critical':
            sectionTitle = section.label
              ? `critical [${section.label}]`
              : 'critical [Critical Section]';
            break;
          case 'par':
            sectionTitle = section.label
              ? `par [${section.label}]`
              : 'par [Parallel]';
            break;
          default:
            sectionTitle = section.label || `${section.type} [Section]`;
        }

        sectionFrame.name = sectionTitle;

        // Calculate section bounds based on actual sequence flow positions
        const allParticipantPositions = Array.from(positions.values());
        const leftmostX =
          Math.min(...allParticipantPositions.map((p) => p.x)) -
          this.PARTICIPANT_WIDTH / 2;
        const rightmostX =
          Math.max(...allParticipantPositions.map((p) => p.x)) +
          this.PARTICIPANT_WIDTH / 2;

        // Find the actual Y positions of messages in this section
        // FIXED: Use proper section bounds based on content
        const sectionItems = sequenceFlow.items.filter(
          (item, itemIndex) =>
            itemIndex >= section.startIndex && itemIndex < section.endIndex
        );

        if (sectionItems.length > 0) {
          const startY =
            Math.min(...sectionItems.map((item) => item.yPosition)) - 40;
          const endY =
            Math.max(...sectionItems.map((item) => item.yPosition)) + 40;

          // Position and size the section frame
          sectionFrame.x = leftmostX - 50;
          sectionFrame.y = startY;
          sectionFrame.resize(rightmostX - leftmostX + 100, endY - startY + 20);

          logger.debug('Section positioned based on content', {
            sectionType: section.type,
            itemCount: sectionItems.length,
            startY,
            endY,
            bounds: {
              x: sectionFrame.x,
              y: sectionFrame.y,
              width: sectionFrame.width,
              height: sectionFrame.height,
            },
          });
        } else {
          // Fallback positioning if no items found
          const baseY =
            this.START_Y +
            this.PARTICIPANT_HEIGHT +
            section.startIndex * this.MESSAGE_SPACING;
          sectionFrame.x = leftmostX - 50;
          sectionFrame.y = baseY - 30;
          sectionFrame.resize(
            rightmostX - leftmostX + 100,
            this.MESSAGE_SPACING * 2
          );

          logger.warn('Section positioned using fallback', {
            sectionType: section.type,
            reason: 'No items found in section',
            fallbackBounds: {
              x: sectionFrame.x,
              y: sectionFrame.y,
              width: sectionFrame.width,
              height: sectionFrame.height,
            },
          });
        }

        // Make frame non-clipping and style it
        sectionFrame.clipsContent = false;
        this.applySectionStyling(sectionFrame, section);

        // Add section title text
        const titleText = await this.createSectionTitleText(
          section,
          sectionFrame
        );

        nodes.push(sectionFrame);
        if (titleText) {
          nodes.push(titleText);
        }

        logger.debug('Created section background', {
          type: section.type,
          title: sectionTitle,
          bounds: {
            x: sectionFrame.x,
            y: sectionFrame.y,
            width: sectionFrame.width,
            height: sectionFrame.height,
          },
          messageRange: `${section.startIndex}-${section.endIndex}`,
        });
      } catch (error) {
        logger.error(`Error creating section: ${section.type}`, { error });
        throw error;
      }
    }

    return nodes;
  }

  private async createSectionTitleText(
    section: Section,
    sectionFrame: FrameNode
  ): Promise<TextNode | null> {
    try {
      let titleText = '';

      switch (section.type) {
        case 'rect':
          titleText = section.label || '📦 Section';
          break;
        case 'alt':
          titleText = section.condition
            ? `alt [${section.condition}]`
            : 'alt [Alternative]';
          break;
        case 'opt':
          titleText = section.condition
            ? `opt [${section.condition}]`
            : 'opt [Optional]';
          break;
        case 'loop':
          titleText = section.condition
            ? `loop [${section.condition}]`
            : 'loop [Iteration]';
          break;
        case 'critical':
          titleText = section.label
            ? `critical [${section.label}]`
            : 'critical [Critical Section]';
          break;
        case 'par':
          titleText = section.label
            ? `par [${section.label}]`
            : 'par [Parallel]';
          break;
        default:
          titleText = section.label || `${section.type} [Section]`;
      }

      const textNode = figma.createText();
      textNode.characters = titleText;
      textNode.fontName = { family: 'Inter', style: 'Bold' };
      textNode.fontSize = 12;

      // Position title at top-left of section with some padding
      textNode.x = sectionFrame.x + 10;
      textNode.y = sectionFrame.y + 5;
      textNode.textAlignHorizontal = 'LEFT';

      // Color based on section type
      switch (section.type) {
        case 'rect':
          textNode.fills = [
            { type: 'SOLID', color: { r: 0.3, g: 0.3, b: 0.3 } },
          ];
          break;
        case 'alt':
          textNode.fills = [
            { type: 'SOLID', color: { r: 0.8, g: 0.6, b: 0.2 } },
          ];
          break;
        case 'opt':
          textNode.fills = [
            { type: 'SOLID', color: { r: 0.2, g: 0.7, b: 0.2 } },
          ];
          break;
        case 'loop':
          textNode.fills = [
            { type: 'SOLID', color: { r: 0.6, g: 0.2, b: 0.8 } },
          ];
          break;
        case 'critical':
          textNode.fills = [
            { type: 'SOLID', color: { r: 0.8, g: 0.2, b: 0.2 } },
          ];
          break;
        case 'par':
          textNode.fills = [
            { type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8 } },
          ];
          break;
        default:
          textNode.fills = [
            { type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } },
          ];
      }

      textNode.name = `Section Title: ${titleText}`;
      return textNode;
    } catch (error) {
      logger.error('Error creating section title', { error });
      return null;
    }
  }

  private applySectionStyling(sectionFrame: FrameNode, section: Section): void {
    // Apply different styling based on section type
    switch (section.type) {
      case 'rect':
        if (section.color) {
          const colorMatch = section.color.match(
            /rgb\((\d+),\s*(\d+),\s*(\d+)\)/
          );
          if (colorMatch) {
            const [, r, g, b] = colorMatch;
            sectionFrame.fills = [
              {
                type: 'SOLID',
                color: {
                  r: parseInt(r) / 255,
                  g: parseInt(g) / 255,
                  b: parseInt(b) / 255,
                },
                opacity: 0.1,
              },
            ];
          }
        } else {
          sectionFrame.fills = [
            { type: 'SOLID', color: { r: 0.9, g: 0.95, b: 1 }, opacity: 0.2 },
          ];
        }
        break;
      case 'alt':
        sectionFrame.fills = [
          { type: 'SOLID', color: { r: 1, g: 0.95, b: 0.8 }, opacity: 0.15 },
        ];
        sectionFrame.strokes = [
          { type: 'SOLID', color: { r: 0.8, g: 0.6, b: 0.2 } },
        ];
        sectionFrame.strokeWeight = 1.5;
        sectionFrame.dashPattern = [8, 4];
        break;
      case 'opt':
        sectionFrame.fills = [
          { type: 'SOLID', color: { r: 0.8, g: 1, b: 0.8 }, opacity: 0.15 },
        ];
        sectionFrame.strokes = [
          { type: 'SOLID', color: { r: 0.2, g: 0.8, b: 0.2 } },
        ];
        sectionFrame.strokeWeight = 1.5;
        break;
      case 'loop':
        sectionFrame.fills = [
          { type: 'SOLID', color: { r: 0.9, g: 0.8, b: 1 }, opacity: 0.15 },
        ];
        sectionFrame.strokes = [
          { type: 'SOLID', color: { r: 0.6, g: 0.2, b: 0.8 } },
        ];
        sectionFrame.strokeWeight = 1.5;
        sectionFrame.dashPattern = [12, 6];
        break;
      case 'critical':
        sectionFrame.fills = [
          { type: 'SOLID', color: { r: 1, g: 0.8, b: 0.8 }, opacity: 0.2 },
        ];
        sectionFrame.strokes = [
          { type: 'SOLID', color: { r: 0.8, g: 0.2, b: 0.2 } },
        ];
        sectionFrame.strokeWeight = 2;
        break;
      case 'par':
        sectionFrame.fills = [
          { type: 'SOLID', color: { r: 0.8, g: 0.9, b: 1 }, opacity: 0.15 },
        ];
        sectionFrame.strokes = [
          { type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8 } },
        ];
        sectionFrame.strokeWeight = 1.5;
        sectionFrame.dashPattern = [4, 4, 12, 4];
        break;
      default:
        sectionFrame.fills = [
          {
            type: 'SOLID',
            color: { r: 0.95, g: 0.95, b: 0.95 },
            opacity: 0.15,
          },
        ];
        sectionFrame.strokes = [
          { type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } },
        ];
        sectionFrame.strokeWeight = 1;
    }
  }
}

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  logger.info('Received message from UI', {
    type: msg.type,
    hasData: !!msg.mermaidCode,
    dataLength: msg.mermaidCode?.length || 0,
    timestamp: new Date().toISOString(),
  });

  if (msg.type === 'render-sequence') {
    try {
      logger.info('Starting sequence diagram rendering process', {
        inputLength: msg.mermaidCode.length,
        firstLines: msg.mermaidCode.split('\n').slice(0, 3),
        totalLines: msg.mermaidCode.split('\n').length,
      });

      const parser = new MermaidSequenceParser();
      const renderer = new SequenceDiagramRenderer();

      logger.info('Parsing Mermaid code...');
      const parseStartTime = Date.now();
      const parsed = parser.parse(msg.mermaidCode);
      const parseEndTime = Date.now();

      logger.info('Parsing completed', {
        parseTimeMs: parseEndTime - parseStartTime,
        result: {
          participantCount: parsed.participants.length,
          messageCount: parsed.messages.length,
          noteCount: parsed.notes.length,
          sectionCount: parsed.sections.length,
        },
      });

      if (parsed.participants.length === 0) {
        const errorMsg =
          'No participants found. Make sure to define participants in your sequence diagram.';
        logger.warn('Validation failed: No participants', {
          inputPreview: msg.mermaidCode.substring(0, 200),
          linesProcessed: msg.mermaidCode.split('\n').length,
        });
        figma.ui.postMessage({
          type: 'error',
          message: errorMsg,
        });
        return;
      }

      logger.info('Starting diagram rendering...');
      const renderStartTime = Date.now();
      await renderer.render(parsed);
      const renderEndTime = Date.now();

      const successMsg = 'Sequence diagram rendered successfully!';
      logger.info('Rendering process completed successfully', {
        renderTimeMs: renderEndTime - renderStartTime,
        totalTimeMs: renderEndTime - parseStartTime,
        performance: {
          parseTime: parseEndTime - parseStartTime,
          renderTime: renderEndTime - renderStartTime,
        },
      });

      figma.ui.postMessage({
        type: 'success',
        message: successMsg,
        data: {
          participantCount: parsed.participants.length,
          messageCount: parsed.messages.length,
          noteCount: parsed.notes.length,
          sectionCount: parsed.sections.length,
          renderTimeMs: renderEndTime - renderStartTime,
          parseTimeMs: parseEndTime - parseStartTime,
        },
      });
    } catch (error) {
      const errorMsg = `Error: ${
        error instanceof Error ? error.message : 'Unknown error occurred'
      }`;

      logger.error('Rendering process failed', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        inputData: {
          length: msg.mermaidCode?.length || 0,
          preview: msg.mermaidCode?.substring(0, 100) || 'No input',
          lines: msg.mermaidCode?.split('\n').length || 0,
        },
        figmaContext: {
          currentPageId: figma.currentPage?.id,
          currentPageName: figma.currentPage?.name,
          hasSelection: figma.currentPage?.selection?.length > 0,
          selectionCount: figma.currentPage?.selection?.length || 0,
        },
      });

      figma.ui.postMessage({
        type: 'error',
        message: errorMsg,
        data: {
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error ? error.stack : undefined,
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
          inputLength: msg.mermaidCode?.length || 0,
        },
      });
    }
  } else {
    logger.warn('Unknown message type received', {
      type: msg.type,
      availableProperties: Object.keys(msg || {}),
      messageStructure: JSON.stringify(msg, null, 2).substring(0, 200),
    });
  }
};

logger.info('Plugin code loaded and message handler registered', {
  timestamp: new Date().toISOString(),
  currentPage: {
    id: figma.currentPage.id,
    name: figma.currentPage.name,
  },
});
