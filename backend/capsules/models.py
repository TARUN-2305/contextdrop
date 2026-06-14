import uuid
from django.db import models
from django.contrib.auth.models import User

class Tag(models.Model):
    name = models.CharField(max_length=50)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tags')

    class Meta:
        unique_together = ('name', 'user')

    def __str__(self):
        return f"{self.name} ({self.user.username})"

class Capsule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.CharField(max_length=8, unique=True)  # short URL component
    title = models.CharField(max_length=255, blank=True, default='')
    creator = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    domain = models.CharField(max_length=50, default='general')  # 'legal', 'medical', 'academic', etc.
    expires_at = models.DateTimeField(null=True, blank=True)
    password_hash = models.CharField(max_length=128, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Stores JSON-serialized list of 3 auto-generated suggested questions
    suggested_questions = models.TextField(blank=True, default='')
    custom_logo_url = models.TextField(blank=True, default='')  # Creator custom logo image URL
    custom_accent_color = models.CharField(max_length=7, blank=True, default='')  # Creator custom HEX code
    tags = models.ManyToManyField(Tag, blank=True, related_name='capsules')

    def __str__(self):
        return f"Capsule {self.slug} ({self.domain})"

class DocumentChunk(models.Model):
    capsule = models.ForeignKey(Capsule, on_delete=models.CASCADE, related_name='chunks')
    text = models.TextField()
    page_number = models.IntegerField(null=True, blank=True)
    section_title = models.CharField(max_length=200, blank=True)
    chunk_index = models.IntegerField()
    embedding = models.TextField()

    def __str__(self):
        return f"Chunk {self.chunk_index} for Capsule {self.capsule.slug}"

class CapsuleAnalytic(models.Model):
    capsule = models.ForeignKey(Capsule, on_delete=models.CASCADE, related_name='analytics')
    question_hash = models.CharField(max_length=64)  # SHA-256 for answered questions privacy
    unanswered_text = models.TextField(blank=True, default='')  # Stored raw ONLY if was_answered is False
    was_answered = models.BooleanField()
    page_number = models.IntegerField(null=True, blank=True)  # cited page if answered
    asked_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Analytic for Capsule {self.capsule.slug} (Answered: {self.was_answered})"
