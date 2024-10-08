import React, { useState, useEffect, useCallback, useContext } from "react";
import { useNavigate } from "react-router-dom";
import DragDrop from "./DragDrop";
import * as pdfjsLib from "pdfjs-dist/webpack";
import Tesseract from "tesseract.js";
import { AccountContext } from "../User/Account";
import EnterManuallyModal from "./EnterManuallyModal";
import "./modal.css";
import { getCalendarResponse } from "../IgnoredFiles/UserInfoGetter"

const Modal = ({ addClassToList, closeModal }) => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
  const [className, setClassName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [assignmentTypes, setAssignmentTypes] = useState([
    { name: "Exam", checked: true, required: true },
    { name: "Lecture", checked: true, required: true },
    { name: "Homework", checked: false, required: false },
    { name: "Project", checked: false, required: false },
  ]);
  const [newAssignmentType, setNewAssignmentType] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [fileContents, setFileContents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [chatMessages, updateChat] = useState([]);
  const [userMessage, updateUserMessage] = useState("");
  const [chatResponse, updateResponse] = useState("");
  const [questions, setQuestions] = useState([]);
  const [questionAnswers, setQuestionAnswers] = useState({});
  const [calendarEvents, setCalendarEvents] = useState([]);
  const { getSession } = useContext(AccountContext);
  const [sessionData, setSessionData] = useState(null);
  const [isManualEntry, setIsManualEntry] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [formattedFileContent, setFormattedFileContent] = useState("");
  const [checkWarning, setCheckWarning] = useState(false);
  const [syllabusContents, setSyllabusContents] = useState("");
  const [classNameError, setClassNameError] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const session = await getSession();
        setSessionData(session);
      } catch (error) {
        console.error("Error fetching session:", error);
        setSessionData(null);
      }
    };
    fetchSession();
  }, []);

  useEffect(() => {
    console.log(syllabusContents);
  }, []);

  const handleClassNameChange = (e) => {
    setClassName(e.target.value); // Allow any value to be entered
    setClassNameError(false); // Reset error when the user starts typing
  };

  const handleNextStep = (manualEntry) => {
    const trimmedClassName = className.trim(); // Trim spaces at the beginning and end

    if (trimmedClassName === "") {
      setClassNameError(true);
    } else {
      setClassName(trimmedClassName);
      if (manualEntry) {
        setCurrentStep(3);
      } else {
        setCurrentStep(2);
      }
    }
  };

  const assignmentTypesToString = () => {
    return assignmentTypes
      .filter((type) => type.checked)
      .map((type) => type.name)
      .join(", ");
  };

  const addCalendarEvent = async (calendarEvent) => {
    if (sessionData) {
      const accessToken = sessionData.accessToken;
      const userId = sessionData.userId;
      try {
        const response = await fetch(
          `https://api.studymaster.io/api/users/${userId}/calendarevents`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: calendarEvent.title,
              startDate: calendarEvent.startDate,
              endDate: calendarEvent.endDate,
              content: calendarEvent.content,
              className: calendarEvent.className,
              type: calendarEvent.type,
            }),
          }
        );
        const data = await response.json();
        if (response.ok) {
          console.log("Response from API:", data);
        } else {
          console.error("Failed to add class:", data.error);
        }
      } catch (err) {
        console.error("Error adding class:", err);
      }
    } else {
      console.error("User is not authenticated");
    }
  };

  const parseResponse = async (response) => {
    if (response.startsWith("True")) {
      const jsonResponse = response.substring(5);
      const parsedQuestions = JSON.parse(jsonResponse);
      setQuestions(parsedQuestions.questions);
      return parsedQuestions.questions;
    } else {
      const calendarEvents = parseCalendarResponse(response);
      setCalendarEvents(calendarEvents);
    }
    return [];
  };

  const addEventsForUser = async (calendarEvents) => {
    for (let i = 0; i < calendarEvents.length; i++) {
      await addCalendarEvent(calendarEvents[i]);
    }
  };

  const onFilesAdded = useCallback((files) => {
    setUploadedFiles(files);
    setIsLoading(true);
    const readers = files.map(async (file) => {
      if (file.type === "application/pdf") {
        return await readPDF(file);
      } else if (file.type === "image/png") {
        return await readPNG(file);
      } else {
        throw new Error("Unsupported file type");
      }
    });
    Promise.all(readers)
      .then((contents) => {
        setFileContents(contents);
        setIsLoading(false);
      })
      .catch((error) => {
        console.error("Error reading files:", error);
        setIsLoading(false);
      });
  }, []);

  const processQuestion = async () => {
    setIsLoading(true);
    let filesContent = syllabusContents;
    if (fileContents.length !== 0) {
      filesContent = fileContents.join("\n\n");
    }
    const assignmentTypes = assignmentTypesToString();
    const calendarResponse = await getCalendarResponse(assignmentTypes, startDate, filesContent);
    await parseResponse(calendarResponse);
    
    setCurrentStep(3);
    setIsLoading(false);
  };

  const readPDF = async (file) => {
    const pdf = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => item.str).join(" ");
    }
    return text;
  };

  const readPNG = async (file) => {
    const result = await Tesseract.recognize(URL.createObjectURL(file), "eng");
    setFormattedFileContent(result.data.text);
    return result.data.text;
  };

  const parseCalendarResponse = (response) => {
    const cleanedResponse = response.replace(/```json|```/g, "");
    const parsedResponse = JSON.parse(cleanedResponse);
    const events = [];
    parsedResponse.forEach((week) => {
      week.sessions.forEach((session) => {
        events.push({
          title: session.title,
          startDate: new Date(`${session.date}T${session.startTime}:00`),
          endDate: new Date(`${session.date}T${session.endTime}:00`),
          content: session.content,
          className: className,
          type: session.type,
        });
      });
    });
    return events;
  };

  const submitEvents = async (filteredEvents) => {
    setIsLoading(true);
    await addEventsForUser(filteredEvents);
    await addClassToList(className, formattedFileContent);
    setClassName("");
    closeModal();
    setQuestions([]);
    setQuestionAnswers({});
    setCalendarEvents([]);
    setIsLoading(false);
    setFileContents([]);
    setFormattedFileContent("");
  };

  const handleCheckboxChange = (index) => {
    const updatedAssignmentTypes = [...assignmentTypes];
    const type = updatedAssignmentTypes[index];

    if (type.required) {
      setCheckWarning(true);
      return;
    }
    setCheckWarning(false);

    updatedAssignmentTypes[index].checked =
      !updatedAssignmentTypes[index].checked;
    setAssignmentTypes(updatedAssignmentTypes);
  };

  const handleAddAssignmentType = () => {
    if (newAssignmentType.trim()) {
      setAssignmentTypes([
        ...assignmentTypes,
        { name: newAssignmentType, checked: true, required: false },
      ]);
      setNewAssignmentType("");
    }
  };

  const renderInitialStep = () => (
    <>
      <div className="modal-header">
        <h2>Enter Course Details</h2>
        <div className="close-icon toggleButton" onClick={closeModal}>
          &times;
        </div>
      </div>
      <div className="modal-content">
        <div className="d-flex flex-row">
          <div
            className="d-flex flex-column justify-content-center"
            style={{ width: "50%" }}
          >
            <div className="input-group">
              <input
                className={`input ${classNameError ? 'input-error' : ''}`}
                type="text"
                value={className}
                onChange={handleClassNameChange}
                required
              />
              {!classNameError ? (
                <label className="label">Name of Course</label>
              ) : (
                <label style={{ color: "red" }} className="label">Please enter name of course</label>
              )}
            </div>
            <div className="input-group">
              <h5>Course Start Date (First day of class):</h5>
              <input
                className="input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="assignment-types">
            <h5>Course Event Types</h5>
            {checkWarning && (
              <p>You must have Exam and Lecture Topics event types</p>
            )}
            <div className="">
              {assignmentTypes.map((type, index) => (
                <div key={index} className="checkbox-group">
                  <input
                    type="checkbox"
                    checked={type.checked}
                    onChange={() => handleCheckboxChange(index)}
                  />
                  <label>{type.name}</label>
                </div>
              ))}
            </div>
            <div className="input-group new-assignment-type">
              <input
                type="text"
                value={newAssignmentType}
                onChange={(e) => setNewAssignmentType(e.target.value)}
                placeholder="Add new type"
              />
              <button
                onClick={handleAddAssignmentType}
                className="button add-button"
              >
                +
              </button>
            </div>
          </div>
        </div>
        <div
          className="d-flex flex-column align-items-center justify-content-center"
          style={{ height: "100%", marginBottom: "140px" }}
        >
          <h3>How will you enter course information?</h3>
          <br />
          <div className="d-flex flex-column justify-content-center align-items-center">
            <div className="d-flex flex-column justify-content-center align-items-center">
              <button
                className="button"
                onClick={() => handleNextStep(false)}
              >
                Upload Syllabus
              </button>
              {"(Use if you have a course syllabus schedule)"}
            </div>
            <br />
            <h5>or</h5>
            <br />
            <div className="d-flex flex-column justify-content-center align-items-center">
              <button
                className="button"
                onClick={() => handleNextStep(true)}
              >
                Enter Events Manually
              </button>
              {"(Use if you don't have a specified course syllabus schedule)"}
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div className="modal open">
      <div className="modal-overlay"></div>
      <div className="modal-container">
        {isLoading && (
          <div className="loading-overlay">
            <div className="spinner"></div>
            <div className="loading-message">Loading content...</div>
          </div>
        )}
        <div className={`form ${isLoading ? "blurred" : ""}`}>
          {currentStep === 0 && renderInitialStep()}
          {currentStep === 2 && !isManualEntry && (
            <>
              <div className="modal-header">
                <h2>Upload Syllabus</h2>
                <div
                  className="small-back-button"
                  onClick={() => {
                    setCurrentStep(0);
                  }}
                >
                  Back
                </div>
              </div>
              <div
                style={{ width: "100%" }}
                className="modal-content d-flex flex-column align-items-center justify-content-between"
              >
                <div style={{ width: "100%" }} id="drag-and-drop">
                  <DragDrop
                    onFilesAdded={onFilesAdded}
                    resetFilesUploaded={syllabusContents}
                  />
                  <br />
                </div>
                <h2>or</h2>
                <textarea
                  value={syllabusContents}
                  onChange={(e) => {
                    setSyllabusContents(e.target.value);
                  }}
                  style={{ height: "200px" }}
                  placeholder="Paste Syllabus Details"
                ></textarea>
              </div>
              <div className="modal-footer">
                <button onClick={processQuestion} className="button">
                  Add
                </button>
              </div>
            </>
          )}
          {currentStep === 2 && isManualEntry && (
            <EnterManuallyModal
              closeModal={() => {
                setCurrentStep(0);
              }}
              addEvent={(event) => {
                setCalendarEvents([...calendarEvents, event]);
              }}
              className={className}
              calendarEvents={calendarEvents}
              assignmentTypes={assignmentTypes}
              uploadEvents={async (updatedCalendarEvents) => {
                submitEvents(updatedCalendarEvents);
              }}
            />
          )}
          {currentStep === 3 && (
            <EnterManuallyModal
              closeModal={closeModal}
              addEvent={(event) => {
                setCalendarEvents([...calendarEvents, event]);
              }}
              className={className}
              calendarEvents={calendarEvents}
              assignmentTypes={assignmentTypes}
              deleteEvent={(event) => {
                const updatedEvents = calendarEvents.filter(
                  (calendarEvent) =>
                    calendarEvent.title !== event.title ||
                    calendarEvent.className !== event.className
                );
                setCalendarEvents(updatedEvents);
              }}
              uploadEvents={async (updatedCalendarEvents) => {
                const filteredEvents = updatedCalendarEvents.filter(
                  (event) => event.type !== "Other"
                );
                await submitEvents(filteredEvents);
                navigate("../");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default Modal;
