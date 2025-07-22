$(document).ready(function() {
    // Global variables for playback control
    let isPlaying = false;
    let isPaused = false;
    let currentStep = 0;
    let intervalId = null;
    let bpm = 120;
    let nextStepTime = 0;
    let lookAhead = 25.0; // How frequently to call scheduling function (in milliseconds)
    let scheduleAheadTime = 0.1; // How far ahead to schedule audio (sec)
    
    // Web Audio API variables
    let audioContext;
    let audioBuffers = {};
    
    // Audio file mappings (matching the order of instruments in the tracker)
    const audioFiles = {
        0: 'samples/bass.wav',    // Bass Drum
        1: 'samples/snare.wav',   // Snare
        2: 'samples/hit.wav'      // Hi Hat
    };

    // Instrument configuration
    const instruments = [
        'Bass Drum',
        'Snare',
        'Hi Hat'
    ];

    const stepsPerPattern = 16*4; // Number of steps in the pattern

    // Generate tracker table
    function generateTrackerTable() {
        const table = $('#tracker');
        table.empty(); // Clear existing content
        
        // Optional: Add header row with step numbers
        const headerRow = $('<tr></tr>');
        headerRow.append('<td></td>'); // Empty cell above instrument names
        for (let step = 1; step <= stepsPerPattern; step++) {
            headerRow.append(`<td class="step-header">${step}</td>`);
        }
        table.append(headerRow);
        
        // Add instrument rows
        instruments.forEach(instrumentName => {
            const row = $('<tr></tr>');
            
            // Add instrument name cell
            const nameCell = $(`<td>${instrumentName}</td>`);
            row.append(nameCell);
            
            // Add pattern cells
            for (let step = 0; step < stepsPerPattern; step++) {
                const stepCell = $('<td>&nbsp;</td>');
                row.append(stepCell);
            }
            
            table.append(row);
        });
    }

    // Calculate interval based on BPM (16th notes)
    function getBeatInterval() {
        return (60000 / bpm) / 4; // 4 subdivisions per beat for 16th notes
    }
    
    // Initialize Web Audio API
    function initAudio() {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            loadAudioFiles();
        } catch (error) {
            console.error('Web Audio API not supported:', error);
        }
    }
    
    // Load all audio files
    async function loadAudioFiles() {
        for (const [index, filename] of Object.entries(audioFiles)) {
            try {
                const response = await fetch(filename);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                audioBuffers[index] = audioBuffer;
                console.log(`Loaded ${filename}`);
            } catch (error) {
                console.error(`Error loading ${filename}:`, error);
            }
        }
    }
    
    // Play audio sample with precise timing
    function playAudioSample(instrumentIndex, when = 0) {
        if (!audioContext || !audioBuffers[instrumentIndex]) {
            return;
        }
        
        // Resume audio context if suspended (required by some browsers)
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffers[instrumentIndex];
        source.connect(audioContext.destination);
        source.start(when);
    }

    // Update BPM display and internal value
    function updateBPM() {
        bpm = parseInt($('#bpmInput').val());
        $('#bpmDisplay').text(bpm);
        
        // If playing, the new BPM will take effect naturally with the scheduler
        // No need to restart playback
        
        // Save BPM to localStorage
        localStorage.setItem('trackerBPM', bpm.toString());
    }

    // Start playback
    function startPlayback() {
        if (isPaused) {
            // Resume from current position
            isPaused = false;
        } else {
            // Start from beginning
            currentStep = 0;
            nextStepTime = audioContext.currentTime;
        }
        
        isPlaying = true;
        scheduler();
        updatePlaybackButtons();
    }

    // Stop playback
    function stopPlayback() {
        isPlaying = false;
        isPaused = false;
        currentStep = 0;
        
        if (intervalId) {
            clearTimeout(intervalId);
            intervalId = null;
        }
        
        clearStepHighlight();
        updatePlaybackButtons();
    }

    // Pause playback
    function pausePlayback() {
        if (isPlaying) {
            isPlaying = false;
            isPaused = true;
            
            if (intervalId) {
                clearTimeout(intervalId);
                intervalId = null;
            }
            
            updatePlaybackButtons();
        }
    }

    // Precise audio scheduler
    function scheduler() {
        // While there are notes that will need to play before the next interval, schedule them
        while (nextStepTime < audioContext.currentTime + scheduleAheadTime) {
            scheduleStep(currentStep, nextStepTime);
            nextStep();
        }
        
        if (isPlaying) {
            intervalId = setTimeout(scheduler, lookAhead);
        }
    }
    
    // Schedule a single step
    function scheduleStep(stepNumber, time) {
        // Update visual highlight on the main thread (not audio-precise timing)
        setTimeout(() => {
            if (isPlaying) {
                updateStepHighlight(stepNumber);
            }
        }, (time - audioContext.currentTime) * 1000);
        
        // Check each instrument row for active cells at current step
        // Skip the header row (index 0)
        $('#tracker tr').slice(1).each(function(instrumentIndex) {
            const currentCell = $(this).find('td').eq(stepNumber + 1);
            
            // Play audio if this cell is active - use precise timing
            if (currentCell.hasClass('active')) {
                playAudioSample(instrumentIndex, time);
            }
        });
    }
    
    // Move to next step and calculate next step time
    function nextStep() {
        const secondsPerStep = (60.0 / bpm) / 4; // 16th notes
        nextStepTime += secondsPerStep;
        currentStep = (currentStep + 1) % stepsPerPattern;
    }
    
    // Update visual step highlight
    function updateStepHighlight(stepNumber) {
        // Clear previous step highlight
        $('.current-step').removeClass('current-step');
        
        // Highlight current step across all instruments
        $('#tracker tr').slice(1).each(function() {
            const currentCell = $(this).find('td').eq(stepNumber + 1);
            currentCell.addClass('current-step');
        });
    }

    // Clear step highlight
    function clearStepHighlight() {
        $('.current-step').removeClass('current-step');
    }

    // Update button states
    function updatePlaybackButtons() {
        $('#startBtn').prop('disabled', isPlaying && !isPaused);
        $('#stopBtn').prop('disabled', !isPlaying && !isPaused);
        $('#pauseBtn').prop('disabled', !isPlaying);
    }

    // Function to save the current song pattern to localStorage
    function saveSong() {
        const songData = [];
        
        // Skip the header row (index 0)
        $('#tracker tr').slice(1).each(function() {
            const rowData = [];
            // Skip the first cell (instrument name) and only save the pattern cells
            $(this).find('td').slice(1).each(function() {
                rowData.push($(this).hasClass('active'));
            });
            songData.push(rowData);
        });
        
        localStorage.setItem('trackerSong', JSON.stringify(songData));
    }

    // Function to load the song pattern from localStorage
    function loadSong() {
        const savedSong = localStorage.getItem('trackerSong');
        
        if (!savedSong) {
            return; // Silently fail if no saved song (for auto-load on page load)
        }
        
        try {
            const songData = JSON.parse(savedSong);
            
            // Skip the header row (index 0)
            $('#tracker tr').slice(1).each(function(i) {
                if (i < songData.length) {
                    const rowData = songData[i];
                    // Skip the first cell (instrument name) and apply the pattern
                    $(this).find('td').slice(1).each(function(j) {
                        if (j < rowData.length) {
                            $(this).toggleClass('active', rowData[j]);
                        }
                    });
                }
            });
        } catch (error) {
            console.error('Error loading song:', error);
        }
    }

    // Function to load saved BPM
    function loadBPM() {
        const savedBPM = localStorage.getItem('trackerBPM');
        if (savedBPM) {
            bpm = parseInt(savedBPM);
            $('#bpmInput').val(bpm);
            $('#bpmDisplay').text(bpm);
        }
    }

    // Function to clear all active cells
    function resetSong() {
        $('#tracker td').removeClass('active');
    }

    // Initialize on page load
    generateTrackerTable();
    loadSong();
    loadBPM();
    updatePlaybackButtons();
    initAudio();

    // Event handlers
    $('#bpmInput').on('input', updateBPM);

    // Handle pattern cell clicks
    $('#tracker').on('click', 'td', function() {
        const cellIndex = $(this).index();
        const rowIndex = $(this).parent().index();
        
        // Skip clicks on header row (step numbers) and instrument name columns
        if (cellIndex > 0 && rowIndex > 0 && !$(this).hasClass('step-header')) {
            $(this).toggleClass('active');
            
            // Play audio preview when toggling a cell on
            if ($(this).hasClass('active')) {
                playAudioSample(rowIndex - 1); // Subtract 1 to account for header row
            }
        }
    });

    // Handle button clicks
    $('#startBtn').on('click', startPlayback);
    $('#stopBtn').on('click', stopPlayback);
    $('#pauseBtn').on('click', pausePlayback);
    $('#resetBtn').on('click', resetSong);
    
    $('#saveBtn').on('click', saveSong);
    $('#loadBtn').on('click', function() {
        loadSong();
    });
});