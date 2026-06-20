const { SerialPort } = require('serialport');
const { DelimiterParser } = require('@serialport/parser-delimiter');
const EventEmitter = require('events');

class MockSerialPort extends EventEmitter {
    constructor() {
        super();
        this.isOpen = true;
        this.scanInterval = null;
        this.ocpInterval = null;
        this.state = {
            running: false,
            collect: true
        };
        // Simulated parameters
        this.refVoltage = 1650; // mV
        this.RTIA = 1000;       // Ohms
        this.currentMode = 2;   // default Cyclic Voltammetry
        this.startingVoltage = -600;
        this.finalVoltage = 600;
        this.scanRate = 10;
        this.quietTime = 1000;
        this.idleVoltage = -300;
        
        // Start background OCP polling simulation on startup
        this.startOcpSimulation();
    }

    write(data, encoding, callback) {
        if (typeof encoding === 'function') {
            callback = encoding;
        }
        
        const cmdStr = data.toString('utf8').trim();
        console.log(`[Mock Serial RX]: "${cmdStr}"`);

        // Parse commands
        try {
            if (cmdStr.startsWith('/')) {
                // Command mode (e.g., /5/ or /1/ for start measurement)
                const parts = cmdStr.split('/').filter(Boolean);
                const cmdMode = parseInt(parts[0]);
                
                if (cmdMode === 5) {
                    // Check Voltage / OCP check
                    this.state.collect = false;
                    this.triggerSingleOcpEmit();
                } else if (cmdMode === 1) {
                    // Start Measurement
                    this.startScan();
                }
            } else {
                // Setting mode (e.g., 2/-600/600/10//)
                const parts = cmdStr.split('/');
                const mode = parseInt(parts[0]);
                
                if (mode > 0 && mode < 4) {
                    this.currentMode = mode;
                    this.startingVoltage = parseFloat(parts[1]) || -600;
                    this.finalVoltage = parseFloat(parts[2]) || 600;
                    this.scanRate = parseFloat(parts[3]) || 10;
                    console.log(`[Mock Serial]: Param set - Mode: ${this.currentMode}, Start: ${this.startingVoltage}mV, Final: ${this.finalVoltage}mV, ScanRate: ${this.scanRate}mV/s`);
                } else if (mode === 6) {
                    // Set idle/ref voltage
                    this.idleVoltage = parseFloat(parts[1]) || -300;
                    console.log(`[Mock Serial]: Set idle voltage to ${this.idleVoltage}mV`);
                } else if (mode === 9) {
                    // Set initial voltage
                    this.initialVoltage = parseFloat(parts[1]) || -300;
                    console.log(`[Mock Serial]: Set initial voltage to ${this.initialVoltage}mV`);
                } else if (mode === 12) {
                    // Set quiet time
                    this.quietTime = parseFloat(parts[1]) || 1000;
                    console.log(`[Mock Serial]: Set quiet time to ${this.quietTime}ms`);
                }
            }
        } catch (e) {
            console.error('[Mock Serial]: Error parsing command', e);
        }

        if (callback) {
            process.nextTick(() => callback(null));
        }
        return true;
    }

    startOcpSimulation() {
        if (this.ocpInterval) clearInterval(this.ocpInterval);
        this.ocpInterval = setInterval(() => {
            if (!this.state.running) {
                this.emitOcpData();
            }
        }, 1500);
    }

    triggerSingleOcpEmit() {
        process.nextTick(() => {
            this.emitOcpData();
        });
    }

    emitOcpData() {
        // Emit stable OCP reading around ~800mV with small noise
        const ocpVal = 800 + (Math.random() - 0.5) * 6;
        const dac = Math.round((ocpVal / 3300) * 4095);
        const volt = Math.round(ocpVal);
        const curr = Math.round(this.refVoltage + (Math.random() - 0.5) * 10);
        
        const packet = JSON.stringify({
            status: "ocp",
            dac: dac,
            volt: volt,
            curr: curr
        });
        
        this.emit('data', Buffer.from(packet + '\n', 'utf8'));
    }

    startScan() {
        if (this.state.running) return;
        
        console.log(`[Mock Serial]: Starting simulated scan (Mode: ${this.currentMode})`);
        this.state.running = true;
        this.state.collect = true;
        
        // Stop background OCP during active scan
        if (this.ocpInterval) clearInterval(this.ocpInterval);

        // Emit start status
        this.emit('data', Buffer.from(JSON.stringify({ status: "start" }) + '\n', 'utf8'));

        let currentVoltage = this.startingVoltage;
        let direction = 1; // 1 = forward sweep, -1 = reverse sweep
        const stepSizeMv = 5; // mV step size per packet
        
        // scanRate is in mV/s. We send steps at intervals.
        // e.g. scanRate = 100 mV/s. With stepSizeMv = 5 mV, we need 20 steps per second (50ms interval)
        const stepsPerSec = this.scanRate / stepSizeMv;
        const intervalMs = Math.max(15, Math.min(200, Math.round(1000 / stepsPerSec)));

        this.scanInterval = setInterval(() => {
            // Apply step
            currentVoltage += direction * stepSizeMv;

            // Check scan boundary
            if (this.currentMode === 2) {
                // Cyclic Voltammetry: Sweep up to final voltage, then down to starting voltage
                if (direction === 1 && currentVoltage >= this.finalVoltage) {
                    currentVoltage = this.finalVoltage;
                    direction = -1;
                } else if (direction === -1 && currentVoltage <= this.startingVoltage) {
                    currentVoltage = this.startingVoltage;
                    this.endScan();
                    return;
                }
            } else {
                // Linear Sweep Voltammetry: Sweep from starting to final voltage and stop
                const finished = (this.startingVoltage <= this.finalVoltage) 
                    ? (currentVoltage >= this.finalVoltage)
                    : (currentVoltage <= this.finalVoltage);
                if (finished) {
                    currentVoltage = this.finalVoltage;
                    this.endScan();
                    return;
                }
            }

            // Simulate electrochemical current
            // Background capacitive charging current (proportional to scan rate & direction)
            const iCapacitive = direction * 0.04 * (this.scanRate / 100); 

            // Faradaic current simulating a redox couple (e.g. peak at +150mV on forward, +50mV on reverse)
            let iFaradaic = 0;
            if (direction === 1) {
                // Oxidation peak centered at 150mV
                iFaradaic = 0.45 * Math.exp(-Math.pow((currentVoltage - 150) / 120, 2));
            } else {
                // Reduction peak centered at 0mV
                iFaradaic = -0.45 * Math.exp(-Math.pow((currentVoltage - 0) / 120, 2));
            }

            // Total current in mA with slight noise
            const totalCurrentMa = iCapacitive + iFaradaic + (Math.random() - 0.5) * 0.015;

            // Map physical parameters back to micro-voltages to replicate hardware ADC/DAC output
            // dac represents actual potential applied at electrode (centered around refVoltage)
            const appliedPotMv = currentVoltage + this.refVoltage;
            const dacVal = Math.round((appliedPotMv / 3300) * 4095);
            
            // volt represents measured potential
            const voltVal = Math.round(appliedPotMv + (Math.random() - 0.5) * 3);
            
            // curr represents raw TIA output voltage read by ADC: (curr - refVoltage) / -RTIA = totalCurrentMa
            // curr = totalCurrentMa * -RTIA + refVoltage
            const currVal = Math.round(totalCurrentMa * -this.RTIA + this.refVoltage + (Math.random() - 0.5) * 5);

            const packet = JSON.stringify({
                dac: Math.max(0, Math.min(4095, dacVal)),
                volt: Math.max(0, Math.min(3300, voltVal)),
                curr: Math.max(0, Math.min(3300, currVal))
            });

            this.emit('data', Buffer.from(packet + '\n', 'utf8'));

        }, intervalMs);
    }

    endScan() {
        if (this.scanInterval) clearInterval(this.scanInterval);
        this.state.running = false;
        this.state.collect = false;
        
        // Emit idle status
        this.emit('data', Buffer.from(JSON.stringify({ status: "idle" }) + '\n', 'utf8'));
        
        console.log('[Mock Serial]: Simulated scan completed successfully');
        
        // Restart OCP background simulation
        this.startOcpSimulation();
    }

    pipe(dest) {
        this.on('data', (data) => dest.write(data));
        return dest;
    }

    close(callback) {
        if (this.scanInterval) clearInterval(this.scanInterval);
        if (this.ocpInterval) clearInterval(this.ocpInterval);
        this.isOpen = false;
        if (callback) callback(null);
    }
}

class SerialPortService extends EventEmitter {
    constructor() {
        super();
        this.port = null;
        this.parser = null;
        this.isConnected = false;
        this.isMock = false;
        
        // Read configuration from environment
        this.configPath = process.env.SERIAL_PORT || 'AUTO';
        this.configBaudRate = parseInt(process.env.BAUD_RATE) || 115200;
        this.forceMock = process.env.MOCK_SERIAL === 'true';
    }

    /**
     * Search and auto-detect microcontrollers or USB-serial converters.
     * @returns {Promise<string|null>}
     */
    async autoDetectPort() {
        try {
            const ports = await SerialPort.list();
            console.log(`Available serial ports:`, ports.map(p => p.path));
            
            // Look for standard microcontroller interfaces
            const targetPort = ports.find(p => {
                const path = p.path.toLowerCase();
                return path.includes('usbmodem') || 
                       path.includes('ttyacm') || 
                       path.includes('usbserial') || 
                       path.includes('ch340') ||
                       path.includes('cp210') ||
                       path.includes('ftdi');
            });
            
            return targetPort ? targetPort.path : null;
        } catch (err) {
            console.error('Failed to list serial ports:', err);
            return null;
        }
    }

    /**
     * Initialize connection
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.forceMock) {
            console.log('Force mock serial enabled. Falling back to Mock Simulation Mode.');
            this.setupMockPort();
            return;
        }

        let portPath = this.configPath;
        if (portPath === 'AUTO') {
            console.log('Attempting to auto-detect potentiostat serial port...');
            portPath = await this.autoDetectPort();
            if (!portPath) {
                console.warn('No physical serial device detected. Falling back to Mock Simulation Mode.');
                this.setupMockPort();
                return;
            }
        }

        console.log(`Connecting to serial device at ${portPath} (${this.configBaudRate} baud)...`);
        
        try {
            this.port = new SerialPort({
                path: portPath,
                baudRate: this.configBaudRate,
                autoOpen: false
            });

            this.port.on('error', (err) => {
                console.error(`Serial port error on path ${portPath}:`, err.message);
                this.emit('error', err);
            });

            this.port.on('close', () => {
                console.log(`Serial port connection closed: ${portPath}`);
                this.isConnected = false;
                this.emit('disconnected');
            });

            return new Promise((resolve) => {
                this.port.open((err) => {
                    if (err) {
                        console.error(`Failed to open serial port on path ${portPath}: ${err.message}. Falling back to Mock Simulation.`);
                        this.setupMockPort();
                        resolve();
                    } else {
                        console.log(`Serial port connection established successfully on ${portPath}`);
                        this.isConnected = true;
                        this.isMock = false;
                        this.setupParser();
                        this.emit('connected');
                        resolve();
                    }
                });
            });
        } catch (err) {
            console.error(`Failed to construct SerialPort for path ${portPath}: ${err.message}. Falling back to Mock Simulation.`);
            this.setupMockPort();
        }
    }

    /**
     * Fallback to mock simulation if no hardware is present
     */
    setupMockPort() {
        console.log('Initializing Simulated Mock Serial Device...');
        this.port = new MockSerialPort();
        this.isConnected = true;
        this.isMock = true;
        this.setupParser();
        process.nextTick(() => {
            this.emit('connected');
        });
    }

    /**
     * Setup delimiter-based parser to read data line-by-line
     */
    setupParser() {
        this.parser = this.port.pipe(new DelimiterParser({ delimiter: '\n' }));

        this.parser.on('data', (data) => {
            const text = data.toString('utf8').trim();
            if (!text) return;
            this.emit('data', text);
        });

        this.parser.on('error', (err) => {
            console.error('Parser error:', err);
            this.emit('error', err);
        });
    }

    /**
     * Promise-wrapped send command
     * @param {string} command
     * @returns {Promise<void>}
     */
    write(command) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected || !this.port) {
                return reject(new Error('Serial connection is not active'));
            }

            this.port.write(command, 'utf-8', (err) => {
                if (err) {
                    console.error('Failed to write to serial interface:', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Close connection
     */
    async close() {
        if (this.port) {
            return new Promise((resolve) => {
                this.port.close(() => {
                    this.isConnected = false;
                    resolve();
                });
            });
        }
    }
}

// Export singleton
module.exports = new SerialPortService();
