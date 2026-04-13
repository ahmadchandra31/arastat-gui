const { error } = require('node:console');
const {SerialPort} = require('serialport')
const fs = require('fs');
const express = require('express')
const { DelimiterParser } = require('@serialport/parser-delimiter');
const bodyParser = require('body-parser');
const path = require('path');
const { stat } = require('node:fs');


const ARASTAT_MODES = {
    "LINEAR_SWEEP_VOLTAMMETRY":1,
    "CYCLIC_VOLTAMMETRY":2,
    "CHRONOAMPEROMETRY":3,
    "SAMPLE_RATE_CHANGE":4,
    "SET_ADC_DAC_DELAY":5,
    "SET_REF_MEAS_VOLTAGE":6,
    "SET_RTIA":7,
}

let state = {
    running:false,
    collect:true,
}

let expData = {
    'startingVoltage':NaN,
    'finalVoltage':NaN,
    'scanRate':NaN,
    'OCPVal':NaN,
    'quietTime':0,
    'idleVoltage':NaN,
    "mode":NaN,
    "dac":[],
    "curr":[],
    "volt":[],
    "name":''
};

const app = express();
const backendPort = 3000;
const server = require('http').createServer(app);
const io = require('socket.io')(server);
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname,'public')));

app.get("/",(req,res)=>{
    // console.log("hello");
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
    // res.render('index.html')

})

app.get("/setting",(req,res)=>{
    res.sendFile(path.join(__dirname, 'public', 'conf.html'));
})

app.get("/view",(req,res)=>{
    res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
})

app.post("/set",(req,res)=>{
    console.log("post accepted");
    console.log(req.body);
    settingHandler(req.body).then(()=>{
        res.send({"message":"lovely!"});
    }).catch((err)=>{
        console.log("error",err);
    });
})

app.post("/getData",(req,res)=>{
    res.send(expData);
})

app.post('/setOCP',(req,res)=>{
    console.log(req.body);
    expData["OCPVal"]=req.body.OCPVal;
})

app.post("/cmd",(req,res)=>{
    console.log("command accepted");
    console.log(req.body)
    commandHandler(req.body).then(()=>{
        res.send({"message":"cmd sent"});
    }).catch((err)=>{
        console.log("Err",err);
    })
})

app.post("/save",(req,res)=>{
    console.log("saving file");
    if (!state.collect && !state.running){
        writeJSONFile().then(()=>{
            res.send(200);
        }).catch((err)=>{
            console.log("error received");
            console.log(err.message);
            res.send(400);    
        });
    }
})

app.post('/setName',(req,res)=>{
    console.log("saving the name");
    expData["name"]=req.body.name;
    res.send(200);
})

app.post('/getName',(req,res)=>{
    const dir = path.join(__dirname,"data");
    console.log(dir);
    console.log(req.body);
    fs.readFile(`${dir}/${req.body.name}.json`,'utf-8',(err,data)=>{
        if (err) {
            console.log(err);
            res.send(400);}
        else res.send(data);
    })

})

app.post('/status',(req,res)=>{
    if (state.running) io.emit("status",{"status":"Running"});
    else io.emit("status",{"status":"Idle"});
})

app.post('/getNames',(req,res)=>{
    const nameList = fs.readdir(path.join(__dirname,'data'),(err,data)=>{
        console.log(data);
        res.send(data);
    })
})

// app.listen(backendPort,()=>{
//     console.log(`http listening.. on port ${backendPort}`);
// })

server.listen(backendPort,()=>{
    console.log("socket listening on port 8080")
})
const port = new SerialPort({path:'/dev/ttyACM0', baudRate:115200},(err)=>{
    if (err) return console.log("error",err.message);
    else console.log("connected");
})



io.on('connection', (socket) => {
  console.log('user connected');
  socket.on('disconnect', function () {
    console.log('user disconnected');
  });
})


port.write('2/-600/600/10//', function(err) {
  if (err) {
    return console.log('Error on write: ', err.message)
  }
  else{
    expData['mode']=2;
    expData['startingVoltage']=-600;
    expData['finalVoltage']=600;
    expData['scanRate']=10;
    console.log('message written');
    }
})

setTimeout(()=>{
        port.write("6/-300//",(err)=>{
            if (err) console.log("Error, ",err.message);
            else {
                expData['idleVoltage']=-300;
                console.log("completed");
            }
        });
    },500);

const parser = port.pipe(new DelimiterParser({ delimiter: '\n' }))

parser.on('data',(data)=>{
    const text = data.toString('utf8');
    try{
        let a = JSON.parse(text);
        switch (a.status){
            case "start":
                state.running = true;
                state.collect = true;
                console.log("start");
                expData.curr=[];
                expData.dac=[];
                expData.volt=[];
                expData.RunningDate = new Date().getTime();
                io.emit("status",{"status":"Running"});
                break;
            case "idle":
                state.running = false;
                state.collect = false;
                io.emit("status",{"status":"Idle"});
                break;
            default:
                break;
        }
        if (state.collect){
            io.emit("data",a);
            if (a.dac !== undefined) expData.dac.push(a.dac);
            if (a.volt !== undefined) expData.volt.push(a.volt);
            if (a.curr !== undefined) expData.curr.push(a.curr);
        }
        else {
            io.emit("ocp",a);
            state.collect=false;
            console.log(a);
        }
    }
    catch (Error){ 
        console.error(`not a JSON string: ${text}`);
        // console.log(text);
    }  
})

// parser.on('data', function (data) {
// //   console.log(data)
//   parser.pause()
//   const text = data.toString('utf8')
//   if (text.length ) {
//     console.log(text)
//   }
//   if (text == "---") {
//     state.running = !state.running;
//     if (state.running) {
//         console.log("start");
//         expData.curr=[];
//         expData.dac=[];
//         expData.volt=[];
//         expData.RunningDate = new Date().getTime();
//     }
//     else console.log("stop");
//     if (state.running) {
//         state.collect = true;
//         io.emit("status",{"status":"Running"});
//         // writeJSONFile();
//     }
//     else {
//         state.collect = false;
//         io.emit("status",{"status":"Idle"});
//     }
// }
//   if (text.includes("{")){
//     try{

//         let a = JSON.parse(text);
//         if (state.collect)
//             {
//                 io.emit("data",a);
//                 expData.dac.push(a.dac);
//                 expData.volt.push(a.volt);
//                 expData.curr.push(a.curr);
//             }
//             else {
//                 io.emit("ocp",a);
//                 state.collect=true;
//                 console.log(a);
//             }
//         }
//     catch (Error){ }
//     }
//   parser.resume();
// })



async function settingHandler(body,cb){
    let buffer = "";
    const mode = ARASTAT_MODES[body.mode];
    // console.log(mode);
    if (mode>0 && mode<4){

        buffer += mode.toString()+"/";
        buffer += body.startingVoltage+"/";
        buffer += body.finalVoltage+"/";
        buffer += body.scanRate+"//";
    }
    else{
        Object.keys(body).forEach((key)=>{
        if (Object.keys(expData).includes(key)) expData[key]=body[key];
        buffer += body[key]+"/";
        })
        buffer+="/";
    }
    console.log(buffer);
    
    await port.write(buffer,'utf-8',(err)=>{
        console.log(err);
        if (err) throw new Error("failed to write");
        else return 1;
    })
}

async function commandHandler(body) {
    let buffer = "/";
    Object.keys(body).forEach((key)=>{
        if (Object.keys(expData).includes(key)) expData[key]=body[key];
        buffer += body[key]+"/";
    })
    buffer+="/";
    console.log(buffer);

    if (body["mode"] == 5) state.collect = false;
    port.write(buffer,'utf-8',(err)=>{
        if (err) throw new Error("failed to write");
        else return 1;
    })
    
}
const writeJSONFile = ()=>{
        let result = 0;
        const date = new Date().getTime();
        const d = new Date(date);
        const pad = n => String(n).padStart(2,'0');
        const formattedDate = `${pad(d.getDate())}${pad(d.getMonth()+1)}${String(d.getFullYear()).slice(-2)}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const dir = path.join(__dirname,'data');
        if (expData.curr.length==0) result=0;
        else result=1;
        fs.writeFile(`${dir}/${formattedDate}.json`,JSON.stringify(expData),'utf-8',(err)=>{
            if (err) console.log("error");
            else console.log("filec reated");
        })
        return new Promise(()=>{
            if (result==1) return 1;
            else throw new Error("Empty file");
        },(err)=>{
            throw new Error("cannot write the JSON file");
        })
}