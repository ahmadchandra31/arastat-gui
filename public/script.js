$(document).ready(() => {
    const socket = io();
    let isupdating = false;
    let isRunning = false;
    let isSubmitting = false;
    let plots = [];

    // Load calibration values from LocalStorage or fall back to defaults
    let refVoltage = parseFloat(localStorage.getItem('refVoltage')) || 1650;
    let RTIA = parseFloat(localStorage.getItem('RTIA')) || 1000;

    // Display loaded calibration values on page load if elements exist
    if ($("#OCP").length) $("#OCP").text(refVoltage);
    if ($("#OCPVal").length) $("#OCPVal").val(refVoltage);
    if ($("#RTIA").length) $("#RTIA").val(RTIA);

    // Dynamic Navigation highlight
    const path = window.location.pathname;
    $('nav .btn').each(function() {
        const href = $(this).attr('href');
        if (href === path) {
            $(this).addClass('active');
        } else {
            $(this).removeClass('active');
        }
    });

    

    socket.on("data", (packet) => {
        const xVal = packet.dac / 4095 * 3300 - refVoltage;
        const yVal = (packet.curr - refVoltage) / -RTIA;
        const xVoltVal = packet.volt - refVoltage;

        // Check if traces are initialized
        if (document.getElementById("tester") && document.getElementById("tester").data) {
            Plotly.extendTraces('tester', { x: [[xVal]], y: [[yVal]] }, [0]);
        }
        if (document.getElementById("tester_") && document.getElementById("tester_").data) {
            Plotly.extendTraces('tester_', { x: [[xVoltVal]], y: [[yVal]] }, [0]);
        }

        // Live metrics update
        // $("#DAC").text(packet.dac);
        // $("#volt").text(Math.round(xVoltVal) + " mV");
        // $("#curr").text(yVal.toFixed(4) + " mA");
    });

    socket.on("ocp", (packet) => {
        isupdating = false;

        $("#DAC").text(packet.dac);
        $("#volt").text(packet.volt);
        $("#curr").text(packet.curr);
    });


    socket.on("status", (packet) => {
        console.log("Status received:", packet.status);
        const statusCard = $("#status-card");
        const statusText = $("#status");

        if (packet.status === "Running") {
            statusText.text("Running");
            statusCard.removeClass("idle").addClass("running");
            isRunning = true;
        } else if (packet.status === "Idle") {
            statusText.text("Idle");
            statusCard.removeClass("running").addClass("idle");
            isRunning = false;
        }
    });

    // Request current status on load
    $.ajax({
        url: '/status',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({}),
        error: function(xhr, status, error) {
            console.error('Failed to sync status:', error);
        }
    });

    const formatUsbDeviceLabel = (device) => {
        if (typeof device === 'string') return device;
        return device.label || device.name || device.path || device.id || JSON.stringify(device);
    };

    const populateUsbDevices = (devices) => {
        const usbElement = $("#usbDevice");
        if (!usbElement.length) return;

        const options = devices.map((device) => {
            const label = formatUsbDeviceLabel(device);
            const value = typeof device === 'string' ? device : device.id || device.path || label;
            return `<option value="${value}">${label}</option>`;
        });

        if (usbElement.is('select')) {
            usbElement.empty();
            usbElement.append('<option value="">-- Select USB Device --</option>');
            usbElement.append(options.join(''));
        } else if (usbElement.is('input, textarea')) {
            usbElement.val(devices.map(formatUsbDeviceLabel).join(', '));
        } else {
            usbElement.text(devices.map(formatUsbDeviceLabel).join('\n'));
        }
    };

    const getUsbDevices = () => {
        $.ajax({
            url: '/usbDevices',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({}),
            dataType: 'json',
            success: function(response) {
                if (Array.isArray(response)) {
                    populateUsbDevices(response);
                } else if (response && Array.isArray(response.devices)) {
                    populateUsbDevices(response.devices);
                } else {
                    console.error('Unexpected USB devices response:', response);
                }
            },
            error: function(xhr, status, error) {
                console.error('Failed to load USB devices:', error);
            }
        });
    };

    socket.on('usbDevices', (devices) => {
        if (Array.isArray(devices)) {
            populateUsbDevices(devices);
        }
    });

    if ($("#usbDevice").length) {
        getUsbDevices();
    }

    // Dark layout configuration for Plotly
    const layout = {
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { t: 15, b: 45, l: 55, r: 15 },
        font: {
            family: 'Plus Jakarta Sans, sans-serif',
            color: '#94a3b8'
        },
        xaxis: {
            title: {
                text: 'V vs Ag/AgCl (mV)',
                font: { size: 12, color: '#64748b', weight: 600 }
            },
            gridcolor: 'rgba(255,255,255,0.03)',
            zerolinecolor: 'rgba(255,255,255,0.08)',
            tickfont: { color: '#64748b', size: 10 }
        },
        yaxis: {
            title: {
                text: 'Current (mA)',
                font: { size: 12, color: '#64748b', weight: 600 }
            },
            gridcolor: 'rgba(255,255,255,0.03)',
            zerolinecolor: 'rgba(255,255,255,0.08)',
            tickfont: { color: '#64748b', size: 10 }
        }
    };

    const canvas1 = document.getElementById("tester");
    const canvas2 = document.getElementById("tester_");

    if (canvas1) {
        Plotly.newPlot(canvas1, [{
            x: [],
            y: [],
            type: 'scatter',
            mode: 'lines',
            line: { color: '#00f2fe', width: 2 }
        }], layout);
    }
    if (canvas2) {
        Plotly.newPlot(canvas2, [{
            x: [],
            y: [],
            type: 'scatter',
            mode: 'lines',
            line: { color: '#d946ef', width: 2 }
        }], layout);
    }

    $("#clearBtn").click((e) => {
        plots = [];
        if (canvas1) {
            Plotly.newPlot(canvas1, [{
                x: [],
                y: [],
                type: 'scatter',
                mode: 'lines',
                line: { color: '#00f2fe', width: 2 }
            }], layout);
        }
        if (canvas2) {
            Plotly.newPlot(canvas2, [{
                x: [],
                y: [],
                type: 'scatter',
                mode: 'lines',
                line: { color: '#d946ef', width: 2 }
            }], layout);
        }
        $("#DAC").text("---");
        $("#volt").text("---");
        $("#curr").text("---");
    });

    $("#checkV").click((e) => {
        if (isupdating) return;
        isupdating = true;
        $.ajax({
            url: '/cmd',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ "mode": 5 }),
            dataType: 'json',
            success: function(response) {
                console.log('Voltage check sent:', response);
            },
            error: function(xhr, status, error) {
                console.error('Error checking voltage:', error);
                isupdating = false;
            }
        });
    });

    $("#startMeasurement").click((e) => {
        if (isRunning) return;
        $.ajax({
            url: '/cmd',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ "mode": 1 }),
            dataType: 'json',
            success: function(response) {
                console.log('Measurement start command acknowledged:', response);
                isRunning = true;
            },
            error: function(xhr, status, error) {
                console.error('Error starting measurement:', error);
                alert("Failed to start measurement");
            }
        });
    });

    $("#stopMeasurement").click((e) => {
        if (!isRunning) return;
        $.ajax({
            url: '/cmd',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ "mode": 3 }),
            dataType: 'json',
            success: function(response) {
                console.log('Measurement stop command acknowledged:', response);
                alert("Measurement stopped successfully.");
                statusText.text("Idle");
                statusCard.removeClass("running").addClass("idle");
                isRunning = false;

            },
            error: function(xhr, status, error) {
                console.error('Error stopping measurement:', error);
                alert("Failed to stop measurement");
            }
        });
    });

    $("#turnOffDevice").click((e) => {
        $.ajax({
            url: '/cmd',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ "mode": 4 }),
            dataType: 'json',
            success: function(response) {
                console.log('Device turn off command acknowledged:', response);
                alert("Device turned off successfully.");
                statusText.text("Idle");
                statusCard.removeClass("running").addClass("idle");
                isRunning = false;
            },
            error: function(xhr, status, error) {
                console.error('Error turning off device:', error);
                alert("Failed to turn off device");
            }});
        });

    const formSubmissionHandler = () => {
        if (isSubmitting) {
            alert("Another parameter configuration process is currently active.");
            return;
        }
        isSubmitting = true;
        const data = {
            mode: parseInt($("#mode").val()),
            startingVoltage: parseInt($("#startingVoltage").val()),
            finalVoltage: parseInt($("#finalVoltage").val()),
            scanRate: parseInt($("#scanRate").val())
        };

        $.ajax({
            url: '/set',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function(response) {
                console.log('Parameters updated successfully:', response);
                isRunning = false;
                isSubmitting = false;
                alert("Sweep parameters updated successfully!");
            },
            error: function(xhr, status, error) {
                console.error('Failed to set sweep parameters:', error);
                alert("Failed to set sweep parameters: " + (xhr.responseJSON ? xhr.responseJSON.message : error));
                isSubmitting = false;
            }
        });
    };

    $("#formSubmission").click((e) => {
        e.preventDefault();
        formSubmissionHandler();
    });

    $("#setTime").click((e) => {
        e.preventDefault();
        if (isSubmitting) {
            alert("Another parameter configuration process is currently active.");
            return;
        }
        isSubmitting = true;
        const quietTimeVal = parseInt($("#quietTime").val());
        
        if (!isNaN(quietTimeVal)) {
            $.ajax({
                url: '/set',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ mode: 12, quietTime: quietTimeVal }),
                dataType: 'json',
                success: function(response) {
                    isSubmitting = false;
                    alert("Quiet Time configuration applied!");
                },
                error: function(xhr, status, error) {
                    console.error('Failed to set quiet time:', error);
                    alert("Error setting quiet time");
                    isSubmitting = false;
                }
            });
        } else {
            isSubmitting = false;
            alert("Please enter a valid numeric value for Quiet Time.");
        }
    });

    $("#setIdleVoltage").click((e) => {
        e.preventDefault();
        if (isSubmitting) {
            alert("Another parameter configuration process is currently active.");
            return;
        }
        isSubmitting = true;
        const idleVoltVal = parseInt($("#idleVoltage").val());
        
        if (!isNaN(idleVoltVal)) {
            $.ajax({
                url: '/set',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ mode: 6, idleVoltage: idleVoltVal }),
                dataType: 'json',
                success: function(response) {
                    isSubmitting = false;
                    alert("Idle Voltage configuration applied!");
                },
                error: function(xhr, status, error) {
                    console.error('Failed to set idle voltage:', error);
                    alert("Error setting idle voltage");
                    isSubmitting = false;
                }
            });
        } else {
            isSubmitting = false;
            alert("Please enter a valid numeric value for Idle Voltage.");
        }
    });

    $("#setOCP").click((e) => {
        const valText = $("#volt").text().replace(" mV", "");
        const val = parseInt(valText);
        
        if (isNaN(val)) {
            alert("Please trigger 'Check Voltage' to acquire OCP value first.");
        } else {
            refVoltage = val;
            localStorage.setItem('refVoltage', refVoltage);
            $("#OCP").text(refVoltage + " mV");

            $.ajax({
                url: '/setOCP',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ "OCPVal": val }),
                dataType: 'json',
                success: function(response) {
                    console.log('OCP value cached on server:', response);
                    alert("OCP calibrated to: " + refVoltage + " mV");
                },
                error: function(xhr, status, error) {
                    console.error('Failed to cache OCP on server:', error);
                }
            });
        }
    });

    $("#setInitialVoltage").click((e) => {
        e.preventDefault();
        if (isSubmitting) {
            alert("Another parameter configuration process is currently active.");
            return;
        }
        isSubmitting = true;
        const val = parseInt($("#initialVoltage").val());

        if (!isNaN(val)) {
            $.ajax({
                url: '/set',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ "mode": 9, "initVoltage": val }),
                dataType: 'json',
                success: function(response) {
                    isSubmitting = false;
                    alert("Initial Voltage configuration applied!");
                },
                error: function(xhr, status, error) {
                    console.error('Failed to set initial voltage:', error);
                    isSubmitting = false;
                    alert("Error setting initial voltage");
                }
            });
        } else {
            isSubmitting = false;
            alert("Please enter a valid numeric value for Initial Voltage.");
        }
    });

    $("#save").click((e) => {
        $.ajax({
            url: '/save',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({}),
            dataType: 'json',
            success: function(response) {
                console.log('Experiment saved:', response);
                alert("Measurement successfully saved as: " + response.filename + ".json");
                // Reload filename list
                getNames();
            },
            error: function(xhr, status, error) {
                console.error('Error saving experiment:', error);
                alert("Failed to save measurement: " + (xhr.responseJSON ? xhr.responseJSON.message : error));
            }
        });
    });

    $("#setName").click((e) => {
        e.preventDefault();
        const customName = $("#name").val().trim();
        if (!customName) {
            alert("Please fill in a filename first.");
            return;
        }
        const data = { "name": customName };
        $.ajax({
            url: '/setName',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function(response) {
                console.log('Filename registered:', response);
                alert("Registered file output name: " + customName);
            },
            error: function(xhr, status, error) {
                console.error('Failed to register filename:', error);
                alert("Error setting filename: " + (xhr.responseJSON ? xhr.responseJSON.message : error));
            }
        });
    });

    $("#getName").click((e) => {
        e.preventDefault();
        let name = $("#name").val().trim();
        const nameSelected = $("#nameLists").val();
        
        if (name === '' && (!nameSelected || nameSelected === '')) {
            alert('Please select a saved file or fill in a filename.');
            return;
        }
        
        if (name === '' && nameSelected) {
            name = nameSelected;
        }
        
        console.log("Loading experiment file:", name);
        $.ajax({
            url: '/getName',
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ "name": name }),
            dataType: 'json',
            success: function(response) {
                console.log('File data loaded:', response);
                if (plots.includes(name)) {
                    alert("This run is already loaded on the plot.");
                    return;
                }
                plots.push(name);

                let loadedRefVoltage = refVoltage;
                let loadedRTIA = RTIA;

                if (response.OCPVal && !isNaN(parseInt(response.OCPVal))) loadedRefVoltage = response.OCPVal;
                if (response.RTIA && !isNaN(parseInt(response.RTIA))) loadedRTIA = response.RTIA;

                const xDac = response.dac.map((x) => x / 4095 * 3300 - loadedRefVoltage);
                const xVolt = response.volt.map((x) => x - loadedRefVoltage);
                const curr = response.curr.map((y) => (y - loadedRefVoltage) / -loadedRTIA);

                if (plots.length === 1 && canvas1 && canvas2) {
                    Plotly.newPlot(canvas1, [{ x: xDac, y: curr, name: name, type: 'scatter', mode: 'lines', line: { width: 2 } }], layout);
                    Plotly.newPlot(canvas2, [{ x: xVolt, y: curr, name: name, type: 'scatter', mode: 'lines', line: { width: 2 } }], layout);
                } else {
                    if (canvas1) Plotly.addTraces(canvas1, [{ x: xDac, y: curr, name: name, type: 'scatter', mode: 'lines', line: { width: 2 } }]);
                    if (canvas2) Plotly.addTraces(canvas2, [{ x: xVolt, y: curr, name: name, type: 'scatter', mode: 'lines', line: { width: 2 } }]);
                }
            },
            error: function(xhr, status, error) {
                console.error('Failed to load file:', error);
                alert("Failed to find or load configuration file: " + name);
            }
        });
    });

    $("#setOCPVal").click((e) => {
        e.preventDefault();
        const val = parseInt($("#OCPVal").val());
        if (isNaN(val)) {
            alert("Please enter a valid OCP integer value (mV).");
        } else {
            refVoltage = val;
            localStorage.setItem('refVoltage', refVoltage);
            if ($("#OCP").length) $("#OCP").text(refVoltage);
            alert("Reference OCP updated to: " + refVoltage + " mV");
        }
    });

    $("#resetOCP").click((e) => {
        e.preventDefault();
        refVoltage = 1650;
        localStorage.setItem('refVoltage', refVoltage);
        if ($("#OCP").length) $("#OCP").text(refVoltage);
        if ($("#OCPVal").length) $("#OCPVal").val(refVoltage);
        alert("Reference OCP reset to default: " + refVoltage + " mV");
    });

    $("#setRTIA").click((e) => {
        e.preventDefault();
        const val = parseFloat($("#RTIA").val());
        if (isNaN(val) || val <= 0) {
            alert("Please enter a valid positive resistor value (ohms).");
        } 
        else {
            $.ajax({
                url: '/log',
                type: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({ "log": { "RTIA": val } }),
                dataType: 'json',
                success: function(response) {
                    console.log('RTIA value updated on server:', response);
                    RTIA = val;
                    localStorage.setItem('RTIA', RTIA);
                    alert("TIA feedback resistor updated to: " + RTIA + " ohms");
                },
                error: function(xhr, status, error) {
                    console.error('Failed to update RTIA on server:', error);
                    alert("Error updating TIA feedback resistor");
                }
            })
        }});

    const getNames = () => {
        $.ajax({
            url: '/getNames',
            type: 'POST',
            contentType: 'application/json',
            dataType: 'json',
            success: function(response) {
                const selectElement = $("#nameLists");
                if (selectElement.length) {
                    selectElement.empty();
                    selectElement.append('<option value="">-- Select Saved Run --</option>');
                    response.forEach((filename) => {
                        const fileNameNoExt = filename.slice(0, -5);
                        selectElement.append(`<option value="${fileNameNoExt}">${fileNameNoExt}</option>`);
                    });
                }
            },
            error: function(xhr, status, error) {
                console.error('Failed to load name list:', error);
            }
        });
    };

    // Initialize list load on relevant pages
    if ($("#nameLists").length) {
        getNames();
    }
});

