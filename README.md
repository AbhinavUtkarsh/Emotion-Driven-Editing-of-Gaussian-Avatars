# Emotion-Driven Editing of GaussianAvatars  
Master’s Thesis in Robotics, Cognition & Intelligence — Technical University of Munich (TUM)

Author: Abhinav Utkarsh, B.Tech. Information Technology  
Supervisor: Prof. Dr. Matthias Nießner  
Advisor: Shivangi Aneja, M.Sc. Informatics  
Date: 5 February 2025 · Munich, Germany
___

## Project Overview
This repository hosts the project webpage and supplementary material for my master’s thesis Emotion-Driven Editing of GaussianAvatars (**EMO-GA**).  
It provides

- a teaser video and multiple qualitative results,  
- a full pipeline overview,
- the full thesis PDF and slide deck,  
- ready-to-copy BibTeX entries, and  
- the source code plus sample pseudo-ground-truth generated training data (coming soon).

## Hardware
All experiments were run locally on my own RTX 4090 GPU.
Diffusion-based editing is GPU-intensive; comparable VRAM is required to regenerate the pseudo ground-truth images. A small pre-computed set will be released for reproduction on less powerful hardware.

## How to cite

### 1. Cite the thesis
```bibtex
@mastersthesis{utkarsh2025emoga,
  title   = {Emotion-Driven Editing of Gaussian Avatars},
  author  = {Utkarsh, Abhinav},
  school  = {Technical University of Munich},
  type    = {Master’s Thesis},
  address = {Munich, Germany},
  year    = {2025},
  month   = {February},
  url     = {https://abhinavutkarsh.com/Emotion-Driven-Editing-of-Gaussian-Avatars/static/pdfs/Emotion-Driven%20Editing%20of%20Gaussian%20Avatars.pdf},
  note    = {Visual Computing \& Artificial Intelligence Lab}
}
```
### 2. Research Credit that EMO-GA heavily uses (More in slide deck)
```bibtex
@article{kirschstein2023nersemble,
  title   = {Nersemble: Multi-View Radiance Field Reconstruction of Human Heads},
  author  = {Kirschstein, Tobias and Qian, Shenhan and Giebenhain, Simon and Walter, Tim and Nie{\ss}ner, Matthias},
  journal = {ACM Transactions on Graphics (TOG)},
  volume  = {42},
  number  = {4},
  pages   = {1--14},
  year    = {2023},
  publisher = {ACM}
}

@inproceedings{qian2024gaussianavatars,
  title     = {GaussianAvatars: Photorealistic Head Avatars with Rigged 3D Gaussians},
  author    = {Qian, Shenhan and Kirschstein, Tobias and Schoneveld, Liam and Davoli, Davide and Giebenhain, Simon and Nie{\ss}ner, Matthias},
  booktitle = {Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition},
  pages     = {20299--20309},
  year      = {2024}
}

@article{zhao2024ultraedit,
  title   = {UltraEdit: Instruction-Based Fine-Grained Image Editing at Scale},
  author  = {Zhao, Haozhe and Ma, Xiaojian and Chen, Liang and Si, Shuzheng and Wu, Rujie and An, Kaikai and Yu, Peiyu and Zhang, Minjia and Li, Qing and Chang, Baobao},
  journal = {arXiv preprint arXiv:2407.05282},
  year    = {2024}
}

@article{aneja2024gaussianspeech,
  title={GaussianSpeech: Audio-Driven Gaussian Avatars},
  author={Aneja, Shivangi and Sevastopolsky, Artem and Kirschstein, Tobias and Thies, Justus and Dai, Angela and Nie{\ss}ner, Matthias},
  journal={arXiv preprint arXiv:2411.18675},
  year={2024}
}
```

## Acknowledgments
Parts of this project page were adopted from the [Nerfies](https://nerfies.github.io/) page.

## Website License
<a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/"><img alt="Creative Commons License" style="border-width:0" src="https://i.creativecommons.org/l/by-sa/4.0/88x31.png" /></a><br />This work is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/">Creative Commons Attribution-ShareAlike 4.0 International License</a>.
