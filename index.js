const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const serialPortService = require('./serialPortService');

const ARASTAT_MODES = {
    "LINEAR_SWEEP_VOLTAMMETRY": 1,
    "CYCLIC_VOLTAMMETRY": 2,
    "CHRONOAMPEROMETRY": 3,
    "SAMPLE_RATE_CHANGE": 4,
    "SET_ADC_DAC_DELAY": 5,
    "SET_REF_MEAS_VOLTAGE": 6,
    "SET_RTIA": 7,
};

let state = {
    running: false,
    collect: true,
};

let expData = {
    'startingVoltage': NaN,
    'finalVoltage': NaN,
    'scanRate': NaN,
    'OCPVal': NaN,
    'quietTime': 0,
    'idleVoltage': NaN,
    "mode": NaN,
    "dac": [],
    "curr": [],
    "volt": [],
    "name": ''
};

const app = express();
const backendPort = process.env.PORT || 3000;
const server = require('http').createServer(app);
const io = require('socket.io')(server);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/setting", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'conf.html'));
});

app.get("/view", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

app.post("/set", (req, res) => {
    console.log("set post accepted:", req.body);
    settingHandler(req.body)
        .then(() => {
            res.status(200).send({ status: "success", message: "Parameters successfully applied to device" });
        })
        .catch((err) => {
            console.error("Error in /set handler:", err);
            res.status(500).send({ status: "error", message: err.message });
        });
});

app.post("/getData", (req, res) => {
    res.send(expData);
});

app.post('/setOCP', (req, res) => {
    console.log("Setting OCP:", req.body);
    expData["OCPVal"] = parseFloat(req.body.OCPVal);
    res.status(200).send({ status: "success", message: "OCP value set" });
});

app.post("/cmd", (req, res) => {
    console.log("Command post accepted:", req.body);
    commandHandler(req.body)
        .then(() => {
            res.status(200).send({ status: "success", message: "Command sent to device" });
        })
        .catch((err) => {
            console.error("Error in /cmd handler:", err);
            res.status(500).send({ status: "error", message: err.message });
        });
});

app.post("/save", (req, res) => {
    console.log("Save request accepted");
    if (!state.collect && !state.running) {
        writeJSONFile()
            .then((filename) => {
                res.status(200).send({ status: "success", filename: filename });
            })
            .catch((err) => {
                console.error("Error saving JSON file:", err.message);
                res.status(400).send({ status: "error", message: err.message });    
            });
    } else {
        res.status(400).send({ status: "error", message: "Cannot save file while experiment is running" });
    }
});

app.post('/setName', (req, res) => {
    console.log("Saving experiment name:", req.body.name);
    if (!req.body.name) {
        return res.status(400).send({ status: "error", message: "Name cannot be empty" });
    }
    // Sanitize to prevent path/filename manipulation
    expData["name"] = path.basename(req.body.name).trim();
    res.status(200).send({ status: "success", message: "Name successfully saved" });
});

app.post('/getName', (req, res) => {
    const dir = path.join(__dirname, "data");
    const nameInput = req.body.name;
    
    if (!nameInput) {
        return res.status(400).send({ status: "error", message: "Filename parameter required" });
    }
    
    const safeName = path.basename(nameInput);
    const filePath = path.join(dir, `${safeName}.json`);

    fs.readFile(filePath, 'utf-8', (err, data) => {
        if (err) {
            console.error(`Failed to read file ${filePath}:`, err.message);
            res.status(404).send({ status: "error", message: "File not found" });
        } else {
            res.status(200).send(data);
        }
    });
});

app.post('/status', (req, res) => {
    const currentStatus = state.running ? "Running" : "Idle";
    io.emit("status", { "status": currentStatus });
    res.status(200).send({ status: "success", state: currentStatus });
});

app.post('/getNames', (req, res) => {
    const dir = path.join(__dirname, 'data');
    
    // Ensure directory exists
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.readdir(dir, (err, data) => {
        if (err) {
            console.error("Failed to read data directory:", err.message);
            return res.status(500).send({ status: "error", message: "Failed to list data files" });
        }
        // Return only JSON configurations
        const jsonFiles = data.filter(file => file.endsWith('.json'));
        res.status(200).send(jsonFiles);
    });
});

// Start Socket & Web Server
server.listen(backendPort, () => {
    console.log(`Arastat GUI server running on http://localhost:${backendPort}`);
});

// Setup Serial Connection and Stream Listeners
serialPortService.initialize().then(() => {
    // Write default CV parameters on startup
    serialPortService.write('2/-600/600/10//')
        .then(() => {
            expData['mode'] = 2;
            expData['startingVoltage'] = -600;
            expData['finalVoltage'] = 600;
            expData['scanRate'] = 10;
            console.log('Startup default scan parameters written to serial port.');
        })
        .catch(err => console.error('Failed to write default startup sweep:', err.message));

}).catch(err => {
    console.error('Serial port initialization failed:', err.message);
});

// Setup Web Socket Connection
io.on('connection', (socket) => {
    console.log('Frontend client connected');
    socket.on('disconnect', () => {
        console.log('Frontend client disconnected');
    });
});

// Stream serial packets to the browser clients
serialPortService.on('data', (text) => {
    try {
        const a = JSON.parse(text);
        switch (a.status) {
            case "start":
                state.running = true;
                state.collect = true;
                console.log("[Experiment Status]: Running");
                expData.curr = [];
                expData.dac = [];
                expData.volt = [];
                expData.RunningDate = new Date().getTime();
                io.emit("status", { "status": "Running" });
                break;
            case "idle":
                state.running = false;
                state.collect = false;
                console.log("[Experiment Status]: Idle");
                io.emit("status", { "status": "Idle" });
                break;
            default:
                break;
        }
        
        if (state.collect) {
            io.emit("data", a);
            if (a.dac !== undefined) expData.dac.push(a.dac);
            if (a.volt !== undefined) expData.volt.push(a.volt);
            if (a.curr !== undefined) expData.curr.push(a.curr);
        } else {
            io.emit("ocp", a);
            state.collect = false;
        }
    } catch (err) {
        console.error(`[Serial Parsing Error]: Failed to parse incoming string "${text}":`, err.message);
    }
});

// Helper handlers for serial parameterization
async function settingHandler(body) {
    const mode = parseInt(body.mode);
    if (isNaN(mode)) {
        throw new Error("Invalid operation mode");
    }

    // Save parameters locally
    Object.keys(body).forEach((key) => {
        if (Object.keys(expData).includes(key)) {
            expData[key] = parseFloat(body[key]);
        }
    });

    let buffer = "";
    if (mode >= 1 && mode <= 3) {
        // Voltammetry parameter format: mode/startingVoltage/finalVoltage/scanRate//
        buffer = `${mode}/${body.startingVoltage}/${body.finalVoltage}/${body.scanRate}//`;
    } else {
        // Parameter configuration formats: mode/val//
        buffer = `${mode}`;
        Object.keys(body).forEach((key) => {
            if (key !== 'mode') {
                buffer += `/${body[key]}`;
            }
        });
        buffer += `//`;
    }

    console.log(`Writing configuration buffer to device: "${buffer}"`);
    await serialPortService.write(buffer);
}

async function commandHandler(body) {
    const mode = parseInt(body.mode);
    if (isNaN(mode)) {
        throw new Error("Invalid command mode");
    }

    // Save configuration parameters locally
    Object.keys(body).forEach((key) => {
        if (Object.keys(expData).includes(key)) {
            expData[key] = parseFloat(body[key]);
        }
    });

    // Formatting as command buffer: /mode/params...//
    let buffer = `/${mode}`;
    Object.keys(body).forEach((key) => {
        if (key !== 'mode') {
            buffer += `/${body[key]}`;
        }
    });
    buffer += `//`;

    console.log(`Writing command buffer to device: "${buffer}"`);
    if (mode === 5) {
        state.collect = false;
    }
    await serialPortService.write(buffer);
}

// Persist scan data to disk
const writeJSONFile = () => {
    return new Promise((resolve, reject) => {
        if (!expData.curr || expData.curr.length === 0) {
            return reject(new Error("Cannot save file: Experiment data set is empty."));
        }

        const date = new Date().getTime();
        const d = new Date(date);
        const pad = n => String(n).padStart(2, '0');
        const formattedDate = `${pad(d.getDate())}${pad(d.getMonth() + 1)}${String(d.getFullYear()).slice(-2)}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const dir = path.join(__dirname, 'data');

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const nameValue = expData.name ? expData.name : formattedDate;
        const filePath = path.join(dir, `${nameValue}.json`);

        fs.writeFile(filePath, JSON.stringify(expData, null, 2), 'utf-8', (err) => {
            if (err) {
                console.error("Error creating measurement file:", err);
                reject(new Error("Could not write file to disk. Check permissions."));
            } else {
                console.log(`Measurement saved successfully: ${nameValue}.json`);
                resolve(nameValue);
            }
        });
    });
};