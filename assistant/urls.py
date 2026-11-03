from django.urls import path

from .views import (
    AskView, CandidatesView, CorrectTranscriptView, DraftCandidatesView,
    StatusView, TaskDraftView, TranscribeView,
)

urlpatterns = [
    path('status/', StatusView.as_view(), name='ai-status'),
    path('transcribe/', TranscribeView.as_view(), name='ai-transcribe'),
    path('correct-transcript/', CorrectTranscriptView.as_view(), name='ai-correct-transcript'),
    path('task-draft/', TaskDraftView.as_view(), name='ai-task-draft'),
    path('candidates/', CandidatesView.as_view(), name='ai-candidates'),
    path('draft-candidates/', DraftCandidatesView.as_view(), name='ai-draft-candidates'),
    path('ask/', AskView.as_view(), name='ai-ask'),
]
