async function setup() {
    const patchExportURL = "export/FM_synth.export.json";

    // Create AudioContext
    const WAContext = window.AudioContext || window.webkitAudioContext;
    const context = new WAContext();

    // Create gain node and connect it to audio output
    const outputNode = context.createGain();
    outputNode.connect(context.destination);
    
    // Fetch the exported patcher
    let response, patcher;
    try {
        response = await fetch(patchExportURL);
        patcher = await response.json();
    
        if (!window.RNBO) {
            // Load RNBO script dynamically
            // Note that you can skip this by knowing the RNBO version of your patch
            // beforehand and just include it using a <script> tag
            await loadRNBOScript(patcher.desc.meta.rnboversion);
        }

    } catch (err) {
        const errorContext = {
            error: err
        };
        if (response && (response.status >= 300 || response.status < 200)) {
            errorContext.header = `Couldn't load patcher export bundle`,
            errorContext.description = `Check app.js to see what file it's trying to load. Currently it's` +
            ` trying to load "${patchExportURL}". If that doesn't` + 
            ` match the name of the file you exported from RNBO, modify` + 
            ` patchExportURL in app.js.`;
        }
        if (typeof guardrails === "function") {
            guardrails(errorContext);
        } else {
            throw err;
        }
        return;
    }
    
    // (Optional) Fetch the dependencies
    let dependencies = [];
    try {
        const dependenciesResponse = await fetch("export/dependencies.json");
        dependencies = await dependenciesResponse.json();

        // Prepend "export" to any file dependenciies
        dependencies = dependencies.map(d => d.file ? Object.assign({}, d, { file: "export/" + d.file }) : d);
    } catch (e) {}

    // Create the device
    let device;
    try {
        device = await RNBO.createDevice({ context, patcher });
    } catch (err) {
        if (typeof guardrails === "function") {
            guardrails({ error: err });
        } else {
            throw err;
        }
        return;
    }

    // (Optional) Load the samples
    if (dependencies.length)
        await device.loadDataBufferDependencies(dependencies);

    // Connect the device to the web audio graph
    device.node.connect(outputNode);

    // (Optional) Extract the name and rnbo version of the patcher from the description
    document.getElementById("patcher-title").innerText = (patcher.desc.meta.filename || "Unnamed Patcher") + " (v" + patcher.desc.meta.rnboversion + ")";

    // (Optional) Automatically create sliders for the device parameters
    // makeSliders(device);

    // (Optional) Create a form to send messages to RNBO inputs
    makeInportForm(device);

    // (Optional) Attach listeners to outports so you can log messages from the RNBO patcher
    attachOutports(device);

    // (Optional) Load presets, if any
    loadPresets(device, patcher);

    // (Optional) Connect MIDI inputs
    makeMIDIKeyboard(device);

    document.body.onclick = () => {
        context.resume();
    }

    // Skip if you're not using guardrails.js
    if (typeof guardrails === "function")
        guardrails();
}

function loadRNBOScript(version) {
    return new Promise((resolve, reject) => {
        if (/^\d+\.\d+\.\d+-dev$/.test(version)) {
            throw new Error("Patcher exported with a Debug Version!\nPlease specify the correct RNBO version to use in the code.");
        }
        const el = document.createElement("script");
        el.src = "https://c74-public.nyc3.digitaloceanspaces.com/rnbo/" + encodeURIComponent(version) + "/rnbo.min.js";
        el.onload = resolve;
        el.onerror = function(err) {
            console.log(err);
            reject(new Error("Failed to load rnbo.js v" + version));
        };
        document.body.append(el);
    });
}

function makeSliders(device) {
    console.log("Device parameters:", device.parameters);

    let pdiv = document.getElementById("rnbo-parameter-sliders");
    let noParamLabel = document.getElementById("no-param-label");
    if (noParamLabel && device.numParameters > 0) pdiv.removeChild(noParamLabel);

    let isDraggingSlider = false;
    let uiElements = {};

    device.parameters.forEach(param => {
        try {
            // 创建标签、滑块和文本输入
            let label = document.createElement("label");
            let slider = document.createElement("input");
            let text = document.createElement("input");
            let sliderContainer = document.createElement("div");
            sliderContainer.appendChild(label);
            sliderContainer.appendChild(slider);
            sliderContainer.appendChild(text);

            // 设置标签
            label.setAttribute("name", param.name);
            label.setAttribute("for", param.name);
            label.setAttribute("class", "param-label");
            label.textContent = `${param.name}: `;

            // 设置滑块
            slider.setAttribute("type", "range");
            slider.setAttribute("class", "param-slider");
            slider.setAttribute("id", param.id);
            slider.setAttribute("name", param.name);
            slider.setAttribute("min", param.min);
            slider.setAttribute("max", param.max);
            slider.setAttribute("step", "0.01"); // 添加更精确的步进值

            // 设置文本输入
            text.setAttribute("type", "number");
            text.setAttribute("class", "param-text");
            text.setAttribute("id", `${param.id}-text`);
            text.setAttribute("name", param.name);
            text.setAttribute("min", param.min);
            text.setAttribute("max", param.max);
            text.setAttribute("step", "0.01");
            text.style.width = "60px"; // 设置文本框宽度

            // 设置初始值
            const initialValue = param.value !== undefined ? param.value : param.default;
            slider.value = initialValue;
            text.value = Number(initialValue).toFixed(2);

            // 修改滑块事件监听器
            slider.addEventListener("input", (e) => {
                const value = parseFloat(e.target.value);
                text.value = value.toFixed(2);
                // 直接使用参数索引设置值
                param.value = value;
                console.log(`Parameter ${param.name} changed to ${value}`);
            });

            // 修改文本框事件监听器
            text.addEventListener("change", (e) => {
                const value = parseFloat(e.target.value);
                if (!isNaN(value)) {
                    slider.value = value;
                    param.value = value;
                    console.log(`Parameter ${param.name} changed to ${value}`);
                }
            });

            // Store the slider and text by name so we can access them later
            uiElements[param.id] = { slider, text };

            // Add the slider element
            pdiv.appendChild(sliderContainer);

        } catch (error) {
            console.error(`Error creating slider for parameter ${param.name}:`, error);
        }
    });

    // Listen to parameter changes from the device
    device.parameterChangeEvent.subscribe(param => {
        try {
            if (!isDraggingSlider && uiElements[param.id]) {
                const value = param.value;
                uiElements[param.id].slider.value = value;
                uiElements[param.id].text.value = value.toFixed(2);
                console.log(`Parameter updated from device: ${param.name} = ${value}`); // 添加调试日志
            }
        } catch (error) {
            console.error(`Error updating parameter ${param.id}:`, error);
        }
    });
}

function makeInportForm(device) {
    const idiv = document.getElementById("rnbo-inports");
    const inportSelect = document.getElementById("inport-select");
    const inportText = document.getElementById("inport-text");
    const inportForm = document.getElementById("inport-form");
    let inportTag = null;
    
    // Device messages correspond to inlets/outlets or inports/outports
    // You can filter for one or the other using the "type" of the message
    const messages = device.messages;
    const inports = messages.filter(message => message.type === RNBO.MessagePortType.Inport);

    if (inports.length === 0) {
        idiv.removeChild(document.getElementById("inport-form"));
        return;
    } else {
        idiv.removeChild(document.getElementById("no-inports-label"));
        inports.forEach(inport => {
            const option = document.createElement("option");
            option.innerText = inport.tag;
            inportSelect.appendChild(option);
        });
        inportSelect.onchange = () => inportTag = inportSelect.value;
        inportTag = inportSelect.value;

        inportForm.onsubmit = (ev) => {
            // Do this or else the page will reload
            ev.preventDefault();

            // Turn the text into a list of numbers (RNBO messages must be numbers, not text)
            const values = inportText.value.split(/\s+/).map(s => parseFloat(s));
            
            // Send the message event to the RNBO device
            let messageEvent = new RNBO.MessageEvent(RNBO.TimeNow, inportTag, values);
            device.scheduleEvent(messageEvent);
        }
    }
}

function attachOutports(device) {
    const outports = device.outports;
    if (outports.length < 1) {
        document.getElementById("rnbo-console").removeChild(document.getElementById("rnbo-console-div"));
        return;
    }

    document.getElementById("rnbo-console").removeChild(document.getElementById("no-outports-label"));
    device.messageEvent.subscribe((ev) => {

        // Ignore message events that don't belong to an outport
        if (outports.findIndex(elt => elt.tag === ev.tag) < 0) return;

        // Message events have a tag as well as a payload
        console.log(`${ev.tag}: ${ev.payload}`);

        document.getElementById("rnbo-console-readout").innerText = `${ev.tag}: ${ev.payload}`;
    });
}

function loadPresets(device, patcher) {
    let presets = patcher.presets || [];
    if (presets.length < 1) {
        document.getElementById("rnbo-presets").removeChild(document.getElementById("preset-select"));
        return;
    }

    document.getElementById("rnbo-presets").removeChild(document.getElementById("no-presets-label"));
    let presetSelect = document.getElementById("preset-select");
    presets.forEach((preset, index) => {
        const option = document.createElement("option");
        option.innerText = preset.name;
        option.value = index;
        presetSelect.appendChild(option);
    });
    presetSelect.onchange = () => device.setPreset(presets[presetSelect.value].preset);
}

function makeMIDIKeyboard(device) {
    let mdiv = document.getElementById("rnbo-clickable-keyboard");
    if (device.numMIDIInputPorts === 0) return;

    mdiv.removeChild(document.getElementById("no-midi-label"));

    const midiNotes = [49, 52, 56, 63];
    midiNotes.forEach(note => {
        const key = document.createElement("div");
        const label = document.createElement("p");
        label.textContent = note;
        key.appendChild(label);
        
        key.addEventListener("pointerdown", async () => {
            let midiChannel = 0;
            
            // 生成随机力度值（70-125之间）
            const velocity = Math.floor(Math.random() * 55) + 70;

            // 确保所有参数都已更新
            device.parameters.forEach(param => {
                // 重新应用当前参数值，确保声音生成时使用最新的参数
                const currentValue = param.value;
                param.value = currentValue;
                console.log(`Applying parameter ${param.name} = ${currentValue}`);
            });

            // 等待一小段时间确保参数已经被应用
            await new Promise(resolve => setTimeout(resolve, 10));

            // 创建MIDI音符开启消息
            let noteOnMessage = [
                144 + midiChannel,  // Note On message
                note,              // MIDI音符号
                velocity           // 力度值
            ];
            
            // 创建MIDI音符关闭消息
            let noteOffMessage = [
                128 + midiChannel,  // Note Off message
                note,              // MIDI音符号
                0                  // 力度值为0
            ];

            let midiPort = 0;
            let noteDurationMs = 250;

            // 确保使用当前的音频上下文时间
            const currentTime = device.context.currentTime * 1000;
            
            // 调度MIDI事件
            let noteOnEvent = new RNBO.MIDIEvent(currentTime, midiPort, noteOnMessage);
            let noteOffEvent = new RNBO.MIDIEvent(currentTime + noteDurationMs, midiPort, noteOffMessage);

            // 发送事件到设备
            device.scheduleEvent(noteOnEvent);
            device.scheduleEvent(noteOffEvent);

            key.classList.add("clicked");
            
            // 打印调试信息
            console.log(`Playing note ${note} with velocity ${velocity}`);
            console.log('Current parameter values:', Array.from(device.parameters).map(p => `${p.name}: ${p.value}`));
        });

        key.addEventListener("pointerup", () => {
            key.classList.remove("clicked");
        });

        mdiv.appendChild(key);
    });
}

function showScore(scoreNum) {
    // 隐藏所有谱子
    const allScores = document.querySelectorAll('.score-image');
    allScores.forEach(score => score.classList.remove('active'));
    
    // 移除所有按钮的激活状态
    const allButtons = document.querySelectorAll('.score-btn');
    allButtons.forEach(btn => btn.classList.remove('active'));
    
    // 显示选中的谱子
    const selectedScore = document.getElementById(`score${scoreNum}`);
    if (selectedScore) {
        selectedScore.classList.add('active');
    }
    
    // 激活对应的按钮
    const selectedButton = document.querySelector(`.score-btn:nth-child(${scoreNum})`);
    if (selectedButton) {
        selectedButton.classList.add('active');
    }
}

// 页面加载时显示第一张谱子
document.addEventListener('DOMContentLoaded', () => {
    showScore(1);
});

setup();
