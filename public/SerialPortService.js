const { SerialPort } = require('serialport');
const { DelimiterParser } = require('@serialport/parser-delimiter');
const EventEmitter = require('events');
// const logger = require('../middleware/logger');
// const { SERIAL_PROTOCOL, ARASTAT_MODES } = require('../utils/constants');
// const config = require('../config');

class SerialPortService extends EventEmitter {
  constructor() {
    super();
    this.port = null;
    this.parser = null;
    this.isConnected = false;
  }

  /**
   * Initialize serial connection
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.port = new SerialPort({
        path: config.SERIAL_PORT,
        baudRate: config.BAUD_RATE,
      });

      this.port.on('error', (err) => {
        console.log('Serial port error:', err.message);
        this.isConnected = false;
        this.emit('error', err);
      });

      this.port.on('open', () => {
        console.log('Serial port opened successfully');
        this.isConnected = true;
        this.setupParser();
        this.emit('connected');
      });

      this.port.on('close', () => {
        console.log('Serial port closed');
        this.isConnected = false;
        this.emit('disconnected');
      });

      return new Promise((resolve, reject) => {
        this.port.on('open', () => resolve());
        this.port.on('error', reject);
      });
    } catch (error) {
      console.log('Failed to initialize serial port:', error.message);
      throw error;
    }
  }

  /**
   * Setup data parser for incoming messages
   * @private
   */
  setupParser() {
    this.parser = this.port.pipe(
      new DelimiterParser({ delimiter: SERIAL_PROTOCOL.DELIMITER })
    );

    this.parser.on('data', (data) => {
      const text = data.toString('utf8').trim();
      if (!text) return;

      console.log('Serial data received:', text);
      this.emit('data', text);
    });

    this.parser.on('error', (err) => {
      console.log('Parser error:', err);
      this.emit('error', err);
    });
  }

  /**
   * Send command to device
   * @param {string} command - Command string
   * @returns {Promise<void>}
   */
  async sendCommand(command) {
    if (!this.isConnected || !this.port) {
      throw new Error('Serial port not connected');
    }

    return new Promise((resolve, reject) => {
      this.port.write(command, (err) => {
        if (err) {
          console.log('Failed to write to serial port:', err);
          reject(new Error('Failed to send command to device'));
        } else {
          console.log('Command sent:', command);
          resolve();
        }
      });
    });
  }

  /**
   * Build and send experiment settings
   * @param {Object} settings - Experiment settings
   * @returns {Promise<void>}
   */
  async sendSettings(settings) {
    const modeCode = ARASTAT_MODES[settings.mode];
    if (!modeCode) {
      throw new Error(`Invalid mode: ${settings.mode}`);
    }

    let buffer = '';

    // For voltammetry modes (1-3), use specific format
    if (modeCode > 0 && modeCode < 4) {
      buffer = `${modeCode}/${settings.startingVoltage}/${settings.finalVoltage}/${settings.scanRate}//`;
    } else {
      // For other modes, append all provided values
      Object.values(settings).forEach((value) => {
        buffer += `${value}/`;
      });
      buffer += '/';
    }

    await this.sendCommand(buffer);
  }

  /**
   * Send raw command
   * @param {Object} command - Command object with properties
   * @returns {Promise<void>}
   */
  async sendRawCommand(command) {
    let buffer = '/';
    Object.values(command).forEach((value) => {
      buffer += `${value}/`;
    });
    buffer += '/';
    await this.sendCommand(buffer);
  }

  /**
   * Close serial connection
   * @returns {Promise<void>}
   */
  async close() {
    if (this.port) {
      return new Promise((resolve, reject) => {
        this.port.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  /**
   * Check if connected
   * @returns {boolean}
   */
  isPortConnected() {
    return this.isConnected;
  }
}

module.exports = new SerialPortService();